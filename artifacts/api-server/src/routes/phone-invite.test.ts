import express, { type NextFunction, type Request, type Response } from "express";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import {
  appUsersTable, businessesTable, db, otpCodesTable, partiesTable, userLoginEventsTable,
  userBusinessesTable, workerInvitesTable, workerPartyAssignmentsTable,
} from "@workspace/db";
import { type AuthenticatedRequest } from "../middlewares/requireAuth";
import { ensureSmsReady, sendOtpSms } from "../services/sms";
import authRouter from "./auth";
import ownerRouter from "./owner";

vi.mock("@clerk/express", () => ({ getAuth: () => ({ userId: null }) }));
vi.mock("../services/sms", () => ({
  ensureSmsReady: vi.fn(),
  sendOtpSms: vi.fn(),
}));

describe("phone worker invitation and verified first sign-in", () => {
  let businessId: string;
  let partyId: string;
  let phone: string;
  let normalized: string;

  const app = express();
  app.use(express.json());
  app.use((req: Request, _res: Response, next: NextFunction) => {
    if (req.path.startsWith("/owner")) {
      const auth = req as AuthenticatedRequest;
      auth.role = "owner";
      auth.status = "active";
      auth.businessId = businessId;
      auth.authMethod = "dev";
    }
    next();
  });
  app.use(ownerRouter);
  app.use(authRouter);

  beforeAll(async () => {
    phone = `017${Math.floor(Math.random() * 100_000_000).toString().padStart(8, "0")}`;
    normalized = `+88${phone}`;
    const [business] = await db.insert(businessesTable).values({ name: "Phone worker invite test" }).returning();
    businessId = business!.id;
    const [party] = await db.insert(partiesTable).values({
      businessId, name: "Assigned party", phone: "", role: "CUSTOMER",
    }).returning();
    partyId = party!.id;
  });

  afterAll(async () => {
    if (!businessId) return;
    await db.delete(otpCodesTable).where(eq(otpCodesTable.phone, normalized));
    const users = await db.select({ id: appUsersTable.id }).from(appUsersTable)
      .where(eq(appUsersTable.businessId, businessId));
    for (const user of users) {
      await db.delete(workerPartyAssignmentsTable).where(eq(workerPartyAssignmentsTable.userId, user.id));
      await db.delete(userBusinessesTable).where(eq(userBusinessesTable.userId, user.id));
    }
    await db.delete(workerInvitesTable).where(eq(workerInvitesTable.businessId, businessId));
    await db.delete(appUsersTable).where(eq(appUsersTable.businessId, businessId));
    await db.delete(partiesTable).where(eq(partiesTable.id, partyId));
    await db.delete(businessesTable).where(eq(businessesTable.id, businessId));
  });

  it("rejects provider failure without saving a usable code", async () => {
    vi.mocked(sendOtpSms).mockRejectedValueOnce(new Error("SMS rejected"));
    const response = await request(app).post("/auth/phone/send-otp").send({ phone });
    expect(response.status).toBe(503);
    expect(response.body).toEqual({ error: "Could not send the SMS code. Please try again later." });
    expect(await db.select().from(otpCodesTable).where(eq(otpCodesTable.phone, normalized))).toHaveLength(0);
  });

  it("lets the invited phone claim only after SMS code verification, without disclosing codes", async () => {
    const invite = await request(app).post("/owner/workers").send({ phone, partyIds: [partyId] });
    expect(invite.status, invite.text).toBe(201);
    expect(vi.mocked(ensureSmsReady)).toHaveBeenCalled();
    const send = await request(app).post("/auth/phone/send-otp").send({ phone });
    expect(send.status, send.text).toBe(200);
    expect(send.body).toEqual({ success: true });
    const code = vi.mocked(sendOtpSms).mock.calls.at(-1)?.[1];
    expect(code).toMatch(/^\d{6}$/);
    const [storedCode] = await db.select().from(otpCodesTable).where(eq(otpCodesTable.phone, normalized));
    expect(storedCode?.code).not.toBe(code);

    const before = await db.select().from(appUsersTable).where(eq(appUsersTable.phone, normalized));
    expect(before).toHaveLength(0);
    const wrongCode = code === "000000" ? "999999" : "000000";
    const wrong = await request(app).post("/auth/phone/verify-otp").send({ phone, code: wrongCode });
    expect(wrong.status).toBe(401);
    const verified = await request(app).post("/auth/phone/verify-otp")
      .set("X-Forwarded-For", "8.8.8.8").send({ phone, code });
    expect(verified.status, verified.text).toBe(200);
    expect(verified.body.token).toEqual(expect.any(String));
    const [staff] = await db.select().from(appUsersTable).where(eq(appUsersTable.phone, normalized));
    expect(staff?.role).toBe("staff");
    expect(staff?.businessId).toBe(businessId);
    const [assignment] = await db.select().from(workerPartyAssignmentsTable)
      .where(eq(workerPartyAssignmentsTable.userId, staff!.id));
    expect(assignment?.partyId).toBe(partyId);
    const identity = await request(app).get("/auth/me")
      .set("Authorization", `Bearer ${verified.body.token}`);
    expect(identity.status).toBe(200);
    expect(identity.body).toMatchObject({ role: "staff", businessId, phone: normalized });
    await request(app).get("/auth/me").set("Authorization", `Bearer ${verified.body.token}`);
    expect(await db.select().from(userLoginEventsTable).where(eq(userLoginEventsTable.userId, staff!.id))).toHaveLength(1);
    const [recorded] = await db.select().from(userLoginEventsTable).where(eq(userLoginEventsTable.userId, staff!.id));
    expect(recorded?.ip).toBeNull(); // No configured policy; never mistake the proxy socket for a user IP.
    const replay = await request(app).post("/auth/phone/verify-otp").send({ phone, code });
    expect(replay.status).toBe(401);
  });

  it("limits requests for the same phone across equivalent number formats", async () => {
    const third = await request(app).post("/auth/phone/send-otp").send({ phone: normalized });
    expect(third.status).toBe(200);
    const fourth = await request(app).post("/auth/phone/send-otp")
      .send({ phone: normalized.slice(1) });
    expect(fourth.status).toBe(429);
    expect(vi.mocked(sendOtpSms)).toHaveBeenCalledTimes(3);
  });
});