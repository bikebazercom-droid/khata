import express from "express";
import request from "supertest";
import { randomInt, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import {
  appUserLoginSessionsTable,
  appUsersTable,
  businessSettingsTable,
  businessesTable,
  db,
  otpCodesTable,
  userBusinessesTable,
  userLoginEventsTable,
} from "@workspace/db";
import { SEED_BUSINESS_ID, requireAuth } from "../middlewares/requireAuth";
import { ensureSmsReady, sendOtpSms } from "../services/sms";
import authRouter from "./auth";
import settingsRouter from "./settings";

const clerkSession = vi.hoisted(() => ({ userId: "", sessionId: "" }));

vi.mock("@clerk/express", () => ({
  getAuth: () => clerkSession.userId
    ? { userId: clerkSession.userId, sessionId: clerkSession.sessionId }
    : { userId: null },
}));

vi.mock("../services/sms", () => ({
  ensureSmsReady: vi.fn().mockResolvedValue(undefined),
  sendOtpSms: vi.fn().mockResolvedValue(undefined),
}));

const clerkUserId = `book-name-onboarding-${randomUUID()}`;
const clerkEmail = `${clerkUserId}@example.test`;
const ownerPhone = `017${String(randomInt(0, 100_000_000)).padStart(8, "0")}`;
const normalizedOwnerPhone = `+88${ownerPhone}`;
const reservedSeedClerkId = `book-name-seed-reservation-${randomUUID()}`;

const app = express();
app.use(express.json());
app.use((req, _res, next) => {
  Object.assign(req, {
    log: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
  });
  next();
});
app.use(authRouter);
app.use(requireAuth, settingsRouter);

describe("first-book name onboarding", () => {
  let reservedSeedUserId: string | undefined;

  beforeAll(async () => {
    await db.insert(businessesTable).values({
      id: SEED_BUSINESS_ID,
      name: "আমার খাতা",
    }).onConflictDoNothing();

    const [seedOwner] = await db.select({ id: appUsersTable.id })
      .from(appUsersTable)
      .where(eq(appUsersTable.businessId, SEED_BUSINESS_ID))
      .limit(1);
    if (!seedOwner) {
      const [reserved] = await db.insert(appUsersTable).values({
        clerkUserId: reservedSeedClerkId,
        businessId: SEED_BUSINESS_ID,
        role: "owner",
      }).returning({ id: appUsersTable.id });
      reservedSeedUserId = reserved!.id;
      await db.insert(userBusinessesTable).values({
        userId: reservedSeedUserId,
        businessId: SEED_BUSINESS_ID,
      });
    }
  });

  afterAll(async () => {
    clerkSession.userId = "";
    clerkSession.sessionId = "";
    await db.delete(otpCodesTable).where(eq(otpCodesTable.phone, normalizedOwnerPhone));

    const [emailUser] = await db.select().from(appUsersTable)
      .where(eq(appUsersTable.clerkUserId, clerkUserId)).limit(1);
    const [phoneUser] = await db.select().from(appUsersTable)
      .where(eq(appUsersTable.phone, normalizedOwnerPhone)).limit(1);
    for (const user of [emailUser, phoneUser].filter((item) => item !== undefined)) {
      await db.delete(appUserLoginSessionsTable).where(eq(appUserLoginSessionsTable.userId, user.id));
      await db.delete(userLoginEventsTable).where(eq(userLoginEventsTable.userId, user.id));
      await db.delete(userBusinessesTable).where(eq(userBusinessesTable.userId, user.id));
      await db.delete(appUsersTable).where(eq(appUsersTable.id, user.id));
      if (user.businessId !== SEED_BUSINESS_ID) {
        await db.delete(businessSettingsTable)
          .where(eq(businessSettingsTable.businessId, user.businessId));
        await db.delete(businessesTable).where(eq(businessesTable.id, user.businessId));
      }
    }

    if (reservedSeedUserId) {
      await db.delete(userBusinessesTable).where(eq(userBusinessesTable.userId, reservedSeedUserId));
      await db.delete(appUsersTable).where(eq(appUsersTable.id, reservedSeedUserId));
    }
  });

  it("opens first-book setup for a newly provisioned Clerk owner, then clears it after saving the primary book", async () => {
    const fetchMetadata = vi.spyOn(globalThis, "fetch").mockImplementation(async () =>
      new Response(JSON.stringify({
        primary_email_address_id: "primary",
        email_addresses: [{
          id: "primary",
          email_address: clerkEmail,
          verification: { status: "verified" },
        }],
      }), { status: 200, headers: { "content-type": "application/json" } }));

    try {
      clerkSession.userId = clerkUserId;
      clerkSession.sessionId = `first-${randomUUID()}`;
      const firstSignIn = await request(app).get("/auth/me").set("Authorization", "Bearer clerk");

      expect(firstSignIn.status, firstSignIn.text).toBe(200);
      expect(firstSignIn.body).toMatchObject({
        role: "owner",
        businessName: "",
        needsBookName: true,
      });

      const [user] = await db.select().from(appUsersTable)
        .where(eq(appUsersTable.clerkUserId, clerkUserId)).limit(1);
      expect(user?.role).toBe("owner");
      expect(user?.businessId).not.toBe(SEED_BUSINESS_ID);
      const [primaryBook] = await db.select().from(businessesTable)
        .where(eq(businessesTable.id, user!.businessId)).limit(1);
      const [settings] = await db.select().from(businessSettingsTable)
        .where(eq(businessSettingsTable.businessId, user!.businessId)).limit(1);
      expect(primaryBook?.name).toBe("");
      expect(settings?.storeName).toBe("");

      const saved = await request(app).patch("/settings")
        .set("Authorization", "Bearer clerk")
        .send({ storeName: "Shakil Traders" });
      expect(saved.status, saved.text).toBe(200);
      expect(saved.body.storeName).toBe("Shakil Traders");

      const [updatedBook] = await db.select().from(businessesTable)
        .where(eq(businessesTable.id, user!.businessId)).limit(1);
      const [updatedSettings] = await db.select().from(businessSettingsTable)
        .where(eq(businessSettingsTable.businessId, user!.businessId)).limit(1);
      const memberships = await db.select().from(userBusinessesTable)
        .where(eq(userBusinessesTable.userId, user!.id));
      expect(updatedBook?.name).toBe("Shakil Traders");
      expect(updatedSettings?.storeName).toBe("Shakil Traders");
      expect(memberships).toHaveLength(1);

      clerkSession.sessionId = `returning-${randomUUID()}`;
      const returningSignIn = await request(app).get("/auth/me").set("Authorization", "Bearer clerk");
      expect(returningSignIn.status, returningSignIn.text).toBe(200);
      expect(returningSignIn.body).toMatchObject({
        role: "owner",
        businessId: user!.businessId,
        businessName: "Shakil Traders",
        needsBookName: false,
      });
      expect(await db.select().from(userBusinessesTable)
        .where(eq(userBusinessesTable.userId, user!.id))).toHaveLength(1);
    } finally {
      clerkSession.userId = "";
      clerkSession.sessionId = "";
      fetchMetadata.mockRestore();
    }
  });

  it("opens setup for a first-time phone owner and returns to the same named book on later sign-ins", async () => {
    vi.mocked(ensureSmsReady).mockReset().mockResolvedValue(undefined);
    vi.mocked(sendOtpSms).mockReset().mockResolvedValue(undefined);

    const sendCode = async () => {
      const sent = await request(app).post("/auth/phone/send-otp").send({ phone: ownerPhone });
      expect(sent.status, sent.text).toBe(200);
      const code = vi.mocked(sendOtpSms).mock.calls.at(-1)?.[1];
      expect(code).toMatch(/^\d{6}$/);
      return code as string;
    };

    const firstCode = await sendCode();
    const firstSignIn = await request(app).post("/auth/phone/verify-otp")
      .send({ phone: ownerPhone, code: firstCode });
    expect(firstSignIn.status, firstSignIn.text).toBe(200);
    expect(firstSignIn.body).toMatchObject({
      role: "owner",
      businessName: "",
      needsBookName: true,
    });

    const [user] = await db.select().from(appUsersTable)
      .where(eq(appUsersTable.phone, normalizedOwnerPhone)).limit(1);
    expect(user?.businessId).not.toBe(SEED_BUSINESS_ID);
    const [settings] = await db.select().from(businessSettingsTable)
      .where(eq(businessSettingsTable.businessId, user!.businessId)).limit(1);
    expect(settings?.storeName).toBe("");

    const firstIdentity = await request(app).get("/auth/me")
      .set("Authorization", `Bearer ${firstSignIn.body.token}`);
    expect(firstIdentity.status, firstIdentity.text).toBe(200);
    expect(firstIdentity.body).toMatchObject({
      role: "owner",
      businessId: user!.businessId,
      needsBookName: true,
    });

    const saved = await request(app).patch("/settings")
      .set("Authorization", `Bearer ${firstSignIn.body.token}`)
      .send({ storeName: "Dhaka General Store" });
    expect(saved.status, saved.text).toBe(200);
    expect(saved.body.storeName).toBe("Dhaka General Store");

    const secondCode = await sendCode();
    const returningSignIn = await request(app).post("/auth/phone/verify-otp")
      .send({ phone: ownerPhone, code: secondCode });
    expect(returningSignIn.status, returningSignIn.text).toBe(200);
    expect(returningSignIn.body).toMatchObject({
      role: "owner",
      businessId: user!.businessId,
      businessName: "Dhaka General Store",
      needsBookName: false,
    });
    const memberships = await db.select().from(userBusinessesTable)
      .where(eq(userBusinessesTable.userId, user!.id));
    expect(memberships).toHaveLength(1);
    const [updatedBook] = await db.select().from(businessesTable)
      .where(eq(businessesTable.id, user!.businessId)).limit(1);
    const [updatedSettings] = await db.select().from(businessSettingsTable)
      .where(eq(businessSettingsTable.businessId, user!.businessId)).limit(1);
    expect(updatedBook?.name).toBe("Dhaka General Store");
    expect(updatedSettings?.storeName).toBe("Dhaka General Store");
  });
});
