import express, { type NextFunction, type Request, type Response } from "express";
import { randomInt } from "node:crypto";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { eq, inArray } from "drizzle-orm";
import jwt from "jsonwebtoken";
import {
  appUsersTable, businessesTable, db, otpCodesTable, partiesTable, userLoginEventsTable,
  userBusinessesTable, workerInvitesTable, workerPartyAssignmentsTable,
} from "@workspace/db";
import {
  PHONE_SESSION_COOKIE_MAX_AGE_MS,
  type AuthenticatedRequest,
} from "../middlewares/requireAuth";
import { ensureSmsReady, sendOtpSms } from "../services/sms";
import { trustedProxyCidrs } from "../middlewares/ipBlock";
import {
  getNormalizedOtpPhoneRateLimitKey,
  getVerifiedOtpIpRateLimitKey,
} from "../lib/otpRateLimitKeys";
import { PostgresRateLimitStore } from "../lib/postgresRateLimitStore";
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
    expect(jwt.decode(verified.body.token)).not.toHaveProperty("exp");
    const rawCookies = verified.headers["set-cookie"];
    const cookies = Array.isArray(rawCookies) ? rawCookies : rawCookies ? [rawCookies] : [];
    expect(cookies.some((cookie) =>
      cookie.startsWith("phone_session=") &&
      cookie.includes(`Max-Age=${PHONE_SESSION_COOKIE_MAX_AGE_MS / 1000}`),
    )).toBe(true);
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

  it("shares send and verify IP limits through a trusted proxy across the real OTP routes", async () => {
    const previousDirect = process.env.CLIENT_IP_MODE;
    const previousTrusted = process.env.TRUSTED_PROXY_CIDRS;
    const clientIp = "203.0.113.55";
    const base = randomInt(10_000_000, 90_000_000);
    const localPhone = (offset: number) => `017${String(base + offset).padStart(8, "0")}`;
    const sendPhones = Array.from({ length: 6 }, (_, index) => localPhone(index));
    const verifyPhones = Array.from({ length: 11 }, (_, index) => localPhone(index + 20));
    process.env.TRUSTED_PROXY_CIDRS = "127.0.0.1/8";
    delete process.env.CLIENT_IP_MODE;
    let ipRateLimitKey: string | null = null;
    const sendIpStore = new PostgresRateLimitStore("otp-send-ip", 15 * 60_000);
    const verifyIpStore = new PostgresRateLimitStore("otp-verify-ip", 15 * 60_000);
    const sendPhoneStore = new PostgresRateLimitStore("otp-send-phone", 15 * 60_000);
    const verifyPhoneStore = new PostgresRateLimitStore("otp-verify-phone", 10 * 60_000);
    const cleanupTestCounters = async () => {
      if (ipRateLimitKey) {
        await sendIpStore.resetKey(ipRateLimitKey);
        await verifyIpStore.resetKey(ipRateLimitKey);
      }
      for (const phone of [...sendPhones, ...verifyPhones]) {
        const key = getNormalizedOtpPhoneRateLimitKey({ body: { phone } } as Request);
        if (sendPhones.includes(phone)) await sendPhoneStore.resetKey(key);
        else await verifyPhoneStore.resetKey(key);
      }
      await db.delete(otpCodesTable).where(inArray(
        otpCodesTable.phone,
        [...sendPhones, ...verifyPhones].map((phone) => `+88${phone}`),
      ));
    };

    const proxiedApp = express();
    proxiedApp.set("trust proxy", trustedProxyCidrs());
    proxiedApp.use(express.json(), authRouter);

    try {
      ipRateLimitKey = getVerifiedOtpIpRateLimitKey({
        ip: clientIp,
        ips: [clientIp],
        body: {},
      } as Request);
      expect(ipRateLimitKey).toBe(clientIp);
      await cleanupTestCounters();
      vi.mocked(ensureSmsReady).mockReset();
      vi.mocked(ensureSmsReady).mockResolvedValue(undefined);
      vi.mocked(sendOtpSms).mockReset();
      vi.mocked(sendOtpSms).mockResolvedValue(undefined);

      const sendStatuses: number[] = [];
      for (const phone of sendPhones) {
        const response = await request(proxiedApp)
          .post("/auth/phone/send-otp")
          .set("X-Forwarded-For", clientIp)
          .send({ phone });
        sendStatuses.push(response.status);
      }
      expect(sendStatuses).toEqual([200, 200, 200, 200, 200, 429]);
      expect(vi.mocked(sendOtpSms)).toHaveBeenCalledTimes(5);

      const verifyStatuses: number[] = [];
      for (const phone of verifyPhones) {
        const response = await request(proxiedApp)
          .post("/auth/phone/verify-otp")
          .set("X-Forwarded-For", clientIp)
          .send({ phone, code: "123456" });
        verifyStatuses.push(response.status);
      }
      expect(verifyStatuses.slice(0, 10)).toEqual(Array(10).fill(401));
      expect(verifyStatuses[10]).toBe(429);
    } finally {
      await cleanupTestCounters();
      if (previousDirect === undefined) delete process.env.CLIENT_IP_MODE;
      else process.env.CLIENT_IP_MODE = previousDirect;
      if (previousTrusted === undefined) delete process.env.TRUSTED_PROXY_CIDRS;
      else process.env.TRUSTED_PROXY_CIDRS = previousTrusted;
    }
  });
});