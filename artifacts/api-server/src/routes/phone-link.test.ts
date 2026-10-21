import express from "express";
import request from "supertest";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import {
  appUsersTable,
  businessesTable,
  db,
  otpCodesTable,
} from "@workspace/db";

const authState = vi.hoisted(() => ({ userId: "", role: "owner" as "owner" | "staff" }));
const sentCodes = vi.hoisted(() => [] as string[]);

vi.mock("../middlewares/requireAuth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../middlewares/requireAuth")>();
  return {
    ...actual,
    requireAuth: (req: any, _res: any, next: any) => {
      req.userId = authState.userId;
      req.businessId = "phone-link-test-business";
      req.role = authState.role;
      req.status = "active";
      req.authMethod = "clerk";
      next();
    },
  };
});

vi.mock("../services/sms", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../services/sms")>();
  return {
    ...actual,
    ensureSmsReady: vi.fn().mockResolvedValue(undefined),
    sendOtpSms: vi.fn(async (_phone: string, code: string) => { sentCodes.push(code); }),
  };
});

import authRouter from "./auth";

describe("authenticated owner phone linking", () => {
  const app = express();
  let businessId: string;
  let ownerId: string;
  const suffix = String(Date.now() % 100_000_000).padStart(8, "0");
  const currentPhone = `+88017${suffix}`;
  const newPhone = `017${String((Number(suffix) + 1) % 100_000_000).padStart(8, "0")}`;
  const normalizedNewPhone = `+88${newPhone}`;
  const alreadyUsedPhone = `+88018${String((Number(suffix) + 2) % 100_000_000).padStart(8, "0")}`;

  app.use(express.json());
  app.use((req: any, _res, next) => {
    req.log = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
    next();
  });
  app.use(authRouter);

  beforeAll(async () => {
    const [business] = await db.insert(businessesTable).values({ name: "Phone link test" }).returning();
    businessId = business!.id;
    const [owner] = await db.insert(appUsersTable).values({
      businessId,
      phone: currentPhone,
      role: "owner",
      clerkUserId: `phone-link-${Date.now()}`,
    }).returning();
    ownerId = owner!.id;
    authState.userId = ownerId;
    const [otherOwner] = await db.insert(appUsersTable).values({
      businessId,
      phone: alreadyUsedPhone,
      role: "owner",
      clerkUserId: `phone-link-other-${Date.now()}`,
    }).returning();
    expect(otherOwner).toBeTruthy();
  });

  afterAll(async () => {
    await db.delete(otpCodesTable).where(eq(otpCodesTable.phone, normalizedNewPhone));
    await db.delete(appUsersTable).where(eq(appUsersTable.id, ownerId));
    await db.delete(appUsersTable).where(eq(appUsersTable.phone, alreadyUsedPhone));
    await db.delete(businessesTable).where(eq(businessesTable.id, businessId));
  });

  afterEach(() => {
    authState.role = "owner";
  });

  it("links a new number to the signed-in owner only after OTP verification", async () => {
    const send = await request(app).post("/auth/phone/link/send-otp").send({ phone: newPhone });
    expect(send.status, send.text).toBe(200);
    const code = sentCodes.at(-1);
    expect(code).toMatch(/^\d{6}$/);
    if (!code) throw new Error("OTP was not captured by the SMS mock");

    const wrong = await request(app).post("/auth/phone/link/verify-otp")
      .send({ phone: newPhone, code: "000000" === code ? "999999" : "000000" });
    expect(wrong.status).toBe(401);
    expect(await db.select().from(otpCodesTable).where(eq(otpCodesTable.phone, normalizedNewPhone))).toHaveLength(1);

    const verified = await request(app).post("/auth/phone/link/verify-otp").send({ phone: newPhone, code });
    expect(verified.status, verified.text).toBe(200);
    expect(verified.body).toMatchObject({ success: true, phone: normalizedNewPhone });
    const [owner] = await db.select().from(appUsersTable).where(eq(appUsersTable.id, ownerId));
    expect(owner?.phone).toBe(normalizedNewPhone);
    expect(await db.select().from(otpCodesTable).where(eq(otpCodesTable.phone, normalizedNewPhone))).toHaveLength(0);
  });

  it("does not let a staff session link a phone", async () => {
    authState.role = "staff";
    const response = await request(app).post("/auth/phone/link/send-otp").send({ phone: newPhone });
    expect(response.status).toBe(403);
    authState.role = "owner";
  });

  it("rejects a phone already linked to a different account", async () => {
    const response = await request(app).post("/auth/phone/link/send-otp").send({ phone: alreadyUsedPhone });
    expect(response.status).toBe(409);
    expect(sentCodes).toHaveLength(1);
  });
});
