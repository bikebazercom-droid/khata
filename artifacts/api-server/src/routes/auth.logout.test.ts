import express from "express";
import request from "supertest";
import jwt from "jsonwebtoken";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import {
  appUserLoginSessionsTable, appUsersTable, businessesTable, db, userBusinessesTable,
} from "@workspace/db";
import authRouter from "./auth";

const clerkSession = vi.hoisted(() => ({ userId: "", oldSessionId: "", newSessionId: "" }));
vi.mock("@clerk/express", () => ({
  getAuth: (req: { headers: { authorization?: string } }) => {
    const token = req.headers.authorization;
    if (token === "Bearer clerk-old") {
      return { userId: clerkSession.userId, sessionId: clerkSession.oldSessionId };
    }
    if (token === "Bearer clerk-new") {
      return { userId: clerkSession.userId, sessionId: clerkSession.newSessionId };
    }
    return { userId: null };
  },
}));

describe("phone session logout", () => {
  let businessId: string;
  let userId: string;
  let phone: string;
  let token: string;

  const app = express();
  app.use(express.json());
  app.use(authRouter);

  beforeAll(async () => {
    phone = `+88017${Math.floor(Math.random() * 100_000_000).toString().padStart(8, "0")}`;
    const [business] = await db.insert(businessesTable).values({ name: "Phone logout test" }).returning();
    businessId = business!.id;
    const [user] = await db.insert(appUsersTable).values({ businessId, phone, role: "staff" }).returning();
    userId = user!.id;
    await db.insert(userBusinessesTable).values({ businessId, userId });
    token = jwt.sign({ userId, businessId, phone, sessionVersion: 0 }, process.env.SESSION_SECRET!, { expiresIn: "30d" });
  });

  afterAll(async () => {
    if (!userId) return;
    await db.delete(userBusinessesTable).where(eq(userBusinessesTable.userId, userId));
    await db.delete(appUsersTable).where(eq(appUsersTable.id, userId));
    await db.delete(businessesTable).where(eq(businessesTable.id, businessId));
  });

  it("revokes a copied mobile bearer token and records the explicit logout", async () => {
    const before = await request(app).get("/auth/me").set("Authorization", `Bearer ${token}`);
    expect(before.status, before.text).toBe(200);

    const logout = await request(app).post("/auth/phone/logout").set("Authorization", `Bearer ${token}`);
    expect(logout.status).toBe(200);
    const [user] = await db.select().from(appUsersTable).where(eq(appUsersTable.id, userId));
    expect(user?.phoneSessionVersion).toBe(1);
    expect(user?.lastLogout).toBeInstanceOf(Date);

    const replay = await request(app).get("/auth/me").set("Authorization", `Bearer ${token}`);
    expect(replay.status).toBe(401);
    const again = await request(app).post("/auth/phone/logout").set("Authorization", `Bearer ${token}`);
    expect(again.status).toBe(200);
    const [afterRetry] = await db.select().from(appUsersTable).where(eq(appUsersTable.id, userId));
    expect(afterRetry?.phoneSessionVersion).toBe(1);
  });

  it("preserves the mobile credential if the server cannot confirm revocation", async () => {
    const [user] = await db.select().from(appUsersTable).where(eq(appUsersTable.id, userId));
    const storedToken = jwt.sign({
      userId, businessId, phone, sessionVersion: user!.phoneSessionVersion,
    }, process.env.SESSION_SECRET!, { expiresIn: "30d" });
    const failingQuery = vi.spyOn(db, "select").mockImplementationOnce(() => {
      throw new Error("Test database outage");
    });
    try {
      const result = await request(app).post("/auth/phone/logout")
        .set("Authorization", `Bearer ${storedToken}`);
      expect(result.status).toBe(500);
    } finally {
      failingQuery.mockRestore();
    }
    const [afterFailure] = await db.select().from(appUsersTable).where(eq(appUsersTable.id, userId));
    expect(afterFailure?.phoneSessionVersion).toBe(user!.phoneSessionVersion);
    const stillValid = await request(app).get("/auth/me").set("Authorization", `Bearer ${storedToken}`);
    expect(stillValid.status).toBe(200);
  });

  it("rejects the old Clerk bearer session after explicit sign-out but allows a different session", async () => {
    clerkSession.userId = `logout-clerk-${crypto.randomUUID()}`;
    clerkSession.oldSessionId = `old-${crypto.randomUUID()}`;
    clerkSession.newSessionId = `new-${crypto.randomUUID()}`;
    const [user] = await db.insert(appUsersTable).values({
      businessId, clerkUserId: clerkSession.userId, role: "owner",
    }).returning();
    await db.insert(userBusinessesTable).values({ userId: user!.id, businessId });
    const lookup = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({
        primary_email_address_id: "verified",
        email_addresses: [{ id: "verified", email_address: "clerk-logout@example.test", verification: { status: "verified" } }],
      }),
    } as Response);
    try {
      const before = await request(app).get("/auth/me").set("Authorization", "Bearer clerk-old");
      expect(before.status, before.text).toBe(200);
      const logout = await request(app).post("/auth/logout-event").set("Authorization", "Bearer clerk-old");
      expect(logout.status, logout.text).toBe(204);
      const copiedOldToken = await request(app).get("/auth/me").set("Authorization", "Bearer clerk-old");
      expect(copiedOldToken.status).toBe(401);

      const [oldSession] = await db.select().from(appUserLoginSessionsTable)
        .where(eq(appUserLoginSessionsTable.sessionId, clerkSession.oldSessionId));
      expect(oldSession?.revokedAt).toBeInstanceOf(Date);
      const newSession = await request(app).get("/auth/me").set("Authorization", "Bearer clerk-new");
      expect(newSession.status, newSession.text).toBe(200);
    } finally {
      lookup.mockRestore();
      await db.delete(userBusinessesTable).where(eq(userBusinessesTable.userId, user!.id));
      await db.delete(appUsersTable).where(eq(appUsersTable.id, user!.id));
    }
  });
});