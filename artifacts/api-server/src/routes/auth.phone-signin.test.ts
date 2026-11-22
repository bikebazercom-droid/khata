import express from "express";
import cookieParser from "cookie-parser";
import request from "supertest";
import { createHmac, randomInt } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq, inArray } from "drizzle-orm";
import {
  appUsersTable,
  businessesTable,
  businessSettingsTable,
  db,
  otpCodesTable,
  partiesTable,
  preapprovedLoginsTable,
  userBusinessesTable,
  userLoginAttemptsTable,
  userLoginEventsTable,
} from "@workspace/db";
import authRouter from "./auth";
import { PostgresRateLimitStore } from "../lib/postgresRateLimitStore";

describe("phone OTP sign-in with the current shared account schema", () => {
  let userId: string;
  let businessId: string;
  const phone = `+88017${String(randomInt(0, 100_000_000)).padStart(8, "0")}`;
  const code = "123456";
  const phoneLimiter = new PostgresRateLimitStore("otp-verify-phone", 10 * 60_000);
  const newPhones = [0, 1].map(() =>
    `+88019${String(randomInt(0, 100_000_000)).padStart(8, "0")}`);
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

  beforeEach(async () => {
    // Each scenario gets a fresh challenge and only its own rate-limit bucket.
    await db.delete(otpCodesTable).where(eq(otpCodesTable.phone, phone));
    await phoneLimiter.resetKey(`phone:${phone}`);
  });

  afterAll(async () => {
    for (const testPhone of [phone, ...newPhones]) {
      await phoneLimiter.resetKey(`phone:${testPhone}`);
    }
    const createdUsers = await db.select().from(appUsersTable)
      .where(inArray(appUsersTable.phone, newPhones));
    for (const created of createdUsers) {
      await db.delete(userLoginEventsTable).where(eq(userLoginEventsTable.userId, created.id));
      await db.delete(userBusinessesTable).where(eq(userBusinessesTable.userId, created.id));
      await db.delete(appUsersTable).where(eq(appUsersTable.id, created.id));
      await db.delete(businessSettingsTable).where(eq(businessSettingsTable.businessId, created.businessId));
      await db.delete(businessesTable).where(eq(businessesTable.id, created.businessId));
    }
    await db.delete(otpCodesTable).where(inArray(otpCodesTable.phone, newPhones));
    await db.delete(userLoginAttemptsTable).where(inArray(userLoginAttemptsTable.identifier, newPhones));
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

  it("lets unapproved Bangladesh numbers create isolated empty ledgers and blocks cross-ledger access", async () => {
    const identities: Array<{ userId: string; businessId: string; token: string }> = [];
    for (const freshPhone of newPhones) {
      expect(await db.select().from(preapprovedLoginsTable)
        .where(eq(preapprovedLoginsTable.identifier, freshPhone))).toHaveLength(0);
      const hashed = createHmac("sha256", process.env.SESSION_SECRET!)
        .update(`${freshPhone}:${code}`).digest("hex");
      await db.insert(otpCodesTable).values({
        phone: freshPhone, code: hashed, expiresAt: new Date(Date.now() + 60_000),
      });
      // Bengali digits and local-format numbers normalize to the same identity.
      const signedIn = await request(app).post("/auth/phone/verify-otp").send({
        phone: freshPhone.slice(3), code: "১২৩৪৫৬",
      });
      expect(signedIn.status, signedIn.text).toBe(200);
      expect(signedIn.body).toMatchObject({ role: "owner", needsBookName: false });
      expect(signedIn.body.businessId).not.toBe("00000000-0000-0000-0000-000000000001");
      expect(signedIn.body.businessId).not.toBe(businessId);
      identities.push(signedIn.body);
      expect(await db.select().from(partiesTable)
        .where(eq(partiesTable.businessId, signedIn.body.businessId))).toHaveLength(0);
    }
    expect(identities[0]!.businessId).not.toBe(identities[1]!.businessId);
    const denied = await request(app).get("/auth/me")
      .set("Authorization", `Bearer ${identities[0]!.token}`)
      .set("x-business-id", identities[1]!.businessId);
    expect(denied.status).toBe(403);
    // A later sign-in must return the same ledger rather than creating another.
    const freshPhone = newPhones[0]!;
    await db.insert(otpCodesTable).values({
      phone: freshPhone,
      code: createHmac("sha256", process.env.SESSION_SECRET!)
        .update(`${freshPhone}:${code}`).digest("hex"),
      expiresAt: new Date(Date.now() + 60_000),
    });
    const again = await request(app).post("/auth/phone/verify-otp")
      .send({ phone: freshPhone, code });
    expect(again.status, again.text).toBe(200);
    expect(again.body.userId).toBe(identities[0]!.userId);
    expect(again.body.businessId).toBe(identities[0]!.businessId);
  });

  it("keeps an OTP usable when session bookkeeping fails and rolls back", async () => {
    await db.insert(otpCodesTable).values({
      phone, code: digest, expiresAt: new Date(Date.now() + 60_000),
    });
    const transaction = db.transaction.bind(db);
    const spy = vi.spyOn(db, "transaction").mockImplementationOnce(
      (async (callback: Parameters<typeof db.transaction>[0]) => transaction(async (tx) => {
        await callback(tx);
        throw new Error("Simulated session bookkeeping failure");
      })) as typeof db.transaction,
    );
    try {
      const failed = await request(app).post("/auth/phone/verify-otp").send({ phone, code });
      expect(failed.status).toBe(500);
      expect(failed.headers["set-cookie"]).toBeUndefined();
      expect(await db.select().from(otpCodesTable)
        .where(eq(otpCodesTable.phone, phone))).toHaveLength(1);
    } finally {
      spy.mockRestore();
    }
    const retry = await request(app).post("/auth/phone/verify-otp").send({ phone, code });
    expect(retry.status, retry.text).toBe(200);
    expect(retry.body.userId).toBe(userId);
  });

  it("allows only one session from concurrent verification of the same OTP", async () => {
    await db.insert(otpCodesTable).values({
      phone, code: digest, expiresAt: new Date(Date.now() + 60_000),
    });
    const results = await Promise.all([0, 1].map(() =>
      request(app).post("/auth/phone/verify-otp").send({ phone, code })));
    expect(results.map((r) => r.status).sort()).toEqual([200, 401]);
  });
});
