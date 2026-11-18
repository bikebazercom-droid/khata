import { randomUUID } from "node:crypto";
import express from "express";
import cookieParser from "cookie-parser";
import request from "supertest";
import { eq } from "drizzle-orm";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import {
  appUsersTable,
  businessSettingsTable,
  businessesTable,
  db,
  userBusinessesTable,
  userLoginEventsTable,
} from "@workspace/db";
import { SEED_BUSINESS_ID } from "../middlewares/requireAuth";
import { supabaseProjectUrl } from "../../../../config/public-auth.json";
import authRouter from "./auth";

const app = express();
app.use(express.json(), cookieParser(), authRouter);

const uid = randomUUID();
const email = `${uid}@example.test`;
const signIn = () => request(app).post("/auth/supabase/session")
  .send({ accessToken: "test-supabase-access-token" });

function mockGoogleIdentity(googleEmail: string, verified = true) {
  vi.stubEnv("VITE_SUPABASE_URL", "https://supabase.example.test");
  vi.stubEnv("VITE_SUPABASE_ANON_KEY", "test-publishable-key");
  vi.spyOn(globalThis, "fetch").mockImplementation(async () => Response.json({
    id: uid,
    email,
    email_confirmed_at: "2026-11-18T00:00:00Z",
    identities: [{ provider: "google", identity_data: { email: googleEmail, email_verified: verified } }],
  }));
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

afterAll(async () => {
  const [user] = await db.select().from(appUsersTable).where(eq(appUsersTable.supabaseUid, uid));
  if (!user) return;
  await db.delete(userLoginEventsTable).where(eq(userLoginEventsTable.userId, user.id));
  await db.delete(userBusinessesTable).where(eq(userBusinessesTable.userId, user.id));
  await db.delete(appUsersTable).where(eq(appUsersTable.id, user.id));
  if (user.businessId === SEED_BUSINESS_ID) return;
  await db.delete(businessSettingsTable).where(eq(businessSettingsTable.businessId, user.businessId));
  await db.delete(businessesTable).where(eq(businessesTable.id, user.businessId));
});

describe("public web Google sign-in", () => {
  it.each([
    ["a different Google email", "other@example.test", true],
    ["an unverified Google email", email, false],
  ])("rejects %s", async (_label, googleEmail, verified) => {
    mockGoogleIdentity(googleEmail, verified);
    expect((await signIn()).status).toBe(401);
  });

  it("opens one isolated book without preapproval and issues a usable session", async () => {
    mockGoogleIdentity(email);
    vi.stubEnv("VITE_SUPABASE_URL", undefined);
    const responses = await Promise.all([signIn(), signIn()]);
    expect(fetch).toHaveBeenCalledWith(`${supabaseProjectUrl}/auth/v1/user`, expect.any(Object));
    const [first, second] = responses;
    expect(first!.status, first!.text).toBe(200);
    expect(second!.status, second!.text).toBe(200);
    const cookie = first!.get("set-cookie")?.[0]?.split(";")[0];
    expect(cookie).toBeTruthy();
    const users = await db.select().from(appUsersTable).where(eq(appUsersTable.verifiedEmail, email));
    expect(users).toHaveLength(1);
    const user = users[0]!;
    expect(user.businessId).not.toBe(SEED_BUSINESS_ID);
    const [settings] = await db.select().from(businessSettingsTable)
      .where(eq(businessSettingsTable.businessId, user.businessId));
    expect(settings?.storeName).toBe("আমার খাতা");
    const session = await request(app).get("/auth/me").set("Cookie", cookie!);
    expect(session.status, session.text).toBe(200);
    expect(session.body).toMatchObject({
      businessId: user.businessId,
      role: "owner",
      needsBookName: false,
    });
  });
});
