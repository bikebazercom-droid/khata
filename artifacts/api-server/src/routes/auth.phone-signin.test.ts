import express from "express";
import cookieParser from "cookie-parser";
import request from "supertest";
import { createHmac, randomInt } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import {
  appUsersTable,
  businessesTable,
  db,
  otpCodesTable,
  userBusinessesTable,
  userLoginAttemptsTable,
  userLoginEventsTable,
} from "@workspace/db";
import authRouter from "./auth";

describe("phone OTP sign-in with the current shared account schema", () => {
  let userId: string;
  let businessId: string;
  const phone = `+88017${String(randomInt(0, 100_000_000)).padStart(8, "0")}`;
  const code = "123456";
  const digest = createHmac("sha256", process.env.SESSION_SECRET!)
    .update(`${phone}:${code}`).digest("hex");
  const app = express();
  app.use(express.json(), cookieParser());
  app.use((req, _res, next) => {
    Object.assign(req, { log: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } });
    next();
  });
  app.use(authRouter);

  beforeAll(async () => {
    const [business] = await db.insert(businessesTable)
      .values({ name: "Phone sign-in regression" }).returning();
    businessId = business!.id;
    // Phone users have no Google identity, but all shared account columns must
    // exist: the same row is read during OTP verification and session restore.
    const [user] = await db.insert(appUsersTable).values({
      businessId, phone, role: "owner", firebaseUid: null, supabaseUid: null,
    }).returning();
    userId = user!.id;
    await db.insert(userBusinessesTable).values({ userId, businessId });
  });

  afterAll(async () => {
    await db.delete(otpCodesTable).where(eq(otpCodesTable.phone, phone));
    await db.delete(userLoginAttemptsTable).where(eq(userLoginAttemptsTable.identifier, phone));
    if (userId) {
      await db.delete(userLoginEventsTable).where(eq(userLoginEventsTable.userId, userId));
      await db.delete(userBusinessesTable).where(eq(userBusinessesTable.userId, userId));
      await db.delete(appUsersTable).where(eq(appUsersTable.id, userId));
    }
    if (businessId) await db.delete(businessesTable).where(eq(businessesTable.id, businessId));
  });

  it("verifies a valid OTP and restores the same private account from its cookie", async () => {
    await db.insert(otpCodesTable).values({
      phone, code: digest, expiresAt: new Date(Date.now() + 60_000),
    });
    const signedIn = await request(app).post("/auth/phone/verify-otp")
      .send({ phone, code });
    expect(signedIn.status, signedIn.text).toBe(200);
    expect(signedIn.body).toMatchObject({
      userId, businessId, authMethod: "phone", role: "owner", needsBookName: false,
    });
    expect(signedIn.body.token).toEqual(expect.any(String));
    const cookies = signedIn.headers["set-cookie"] as unknown as string[];
    const cookie = cookies.find((value) => value.startsWith("phone_session="));
    expect(cookie).toContain("HttpOnly");
    const restored = await request(app).get("/auth/me").set("Cookie", cookie!.split(";")[0]!);
    expect(restored.status, restored.text).toBe(200);
    expect(restored.body).toMatchObject({ userId, businessId, authMethod: "phone" });

    const replay = await request(app).post("/auth/phone/verify-otp").send({ phone, code });
    expect(replay.status).toBe(401);
  });

  it("rejects an incorrect code without consuming the valid OTP", async () => {
    await db.insert(otpCodesTable).values({
      phone, code: digest, expiresAt: new Date(Date.now() + 60_000),
    });
    const rejected = await request(app).post("/auth/phone/verify-otp")
      .send({ phone, code: "654321" });
    expect(rejected.status).toBe(401);
    const remaining = await db.select({ id: otpCodesTable.id })
      .from(otpCodesTable).where(eq(otpCodesTable.phone, phone));
    expect(remaining).toHaveLength(1);
    await db.delete(otpCodesTable).where(eq(otpCodesTable.phone, phone));
  });

  it("rejects an expired OTP instead of issuing a session", async () => {
    await db.insert(otpCodesTable).values({
      phone, code: digest, expiresAt: new Date(Date.now() - 60_000),
    });
    const expired = await request(app).post("/auth/phone/verify-otp").send({ phone, code });
    expect(expired.status).toBe(401);
    expect(expired.headers["set-cookie"]).toBeUndefined();
    expect(expired.body.token).toBeUndefined();
  });
});
