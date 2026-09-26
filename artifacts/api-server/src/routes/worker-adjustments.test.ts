import express, { type Request, type Response, type NextFunction } from "express";
import request from "supertest";
import jwt from "jsonwebtoken";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { eq, inArray } from "drizzle-orm";
import {
  appUsersTable, appUserLoginSessionsTable, businessesTable, db, ledgerEntriesTable,
  partiesTable, userBusinessesTable, workerInvitesTable, workerPartyAssignmentsTable,
} from "@workspace/db";
import { getOrCreateClerkUser, getOrCreatePhoneUser, requireAuth, type AuthenticatedRequest } from "../middlewares/requireAuth";
import { enforceRoleAccess } from "../middlewares/roleAccess";
import ownerRouter from "./owner";
import authRouter from "./auth";
import partiesRouter from "./parties";

const clerk = vi.hoisted(() => ({ id: "" }));
vi.mock("@clerk/express", () => ({
  getAuth: (req: Request) => req.headers["x-clerk-session"]
    ? { userId: clerk.id, sessionId: req.headers["x-clerk-session"] } : { userId: null },
}));
vi.mock("../services/sms", () => ({ ensureSmsReady: vi.fn(), sendOtpSms: vi.fn() }));

describe("staff deletion, explicit re-invitation and scoped adjustments", () => {
  let businessId: string, foreignBusinessId: string, staffId: string;
  let a: string, b: string, c: string, foreign: string;
  const email = `adjustments-${crypto.randomUUID()}@example.test`;
  const phone = `+88017${Math.floor(Math.random() * 100_000_000).toString().padStart(8, "0")}`;
  let token: string;
  const app = express();
  app.use(express.json());
  app.use(authRouter);
  app.use((req: Request, res: Response, next: NextFunction) => {
    if (req.get("Authorization") === "Bearer owner") {
      Object.assign(req as AuthenticatedRequest, {
        userId: "owner", businessId: req.get("x-foreign") ? foreignBusinessId : businessId,
        role: "owner", status: "active", authMethod: "dev",
      });
      next();
    } else { void requireAuth(req, res, next); }
  });
  app.use(enforceRoleAccess, ownerRouter, partiesRouter);

  beforeAll(async () => {
    vi.stubEnv("DEV_AUTH_BYPASS", "false");
    const businesses = await db.insert(businessesTable).values([{ name: "Adjustment tests" }, { name: "Foreign adjustment tests" }]).returning();
    businessId = businesses[0]!.id; foreignBusinessId = businesses[1]!.id;
    const parties = await db.insert(partiesTable).values([
      { businessId, name: "A", role: "CUSTOMER", phone: "" },
      { businessId, name: "B", role: "CUSTOMER", phone: "" },
      { businessId, name: "C", role: "CUSTOMER", phone: "" },
      { businessId: foreignBusinessId, name: "Foreign", role: "CUSTOMER", phone: "" },
    ]).returning();
    [a, b, c, foreign] = parties.map((p) => p.id) as [string, string, string, string];
    const [staff] = await db.insert(appUsersTable).values({ businessId, role: "staff", phone }).returning();
    staffId = staff!.id;
    await db.insert(userBusinessesTable).values({ businessId, userId: staffId });
    await db.insert(workerPartyAssignmentsTable).values([a, b, c].map((partyId) => ({ userId: staffId, partyId })));
    token = jwt.sign({ userId: staffId, phone, sessionVersion: 0 }, process.env.SESSION_SECRET!, { expiresIn: "1h" });
  });
  afterAll(async () => {
    vi.restoreAllMocks(); vi.unstubAllEnvs();
    if (!businessId) return;
    await db.delete(ledgerEntriesTable).where(inArray(ledgerEntriesTable.partyId, [a, b, c, foreign]));
    await db.delete(workerInvitesTable).where(inArray(workerInvitesTable.businessId, [businessId, foreignBusinessId]));
    const users = await db.select({ id: appUsersTable.id }).from(appUsersTable).where(eq(appUsersTable.businessId, businessId));
    for (const { id } of users) {
      await db.delete(userBusinessesTable).where(eq(userBusinessesTable.userId, id));
      await db.delete(appUsersTable).where(eq(appUsersTable.id, id));
    }
    await db.delete(partiesTable).where(inArray(partiesTable.id, [a, b, c, foreign]));
    await db.delete(businessesTable).where(inArray(businessesTable.id, [businessId, foreignBusinessId]));
  });
  const patch = (body: object) => request(app).patch(`/owner/workers/${staffId}`).set("Authorization", "Bearer owner").send(body);
  const transfer = (source: string, destination: string) => request(app).post(`/parties/${source}/ledger-entries`)
    .set("Authorization", `Bearer ${token}`).send({ type: "YOU_GAVE", amount: 10, isTransfer: true, transferPartyId: destination });

  it("defaults to no adjustment rights while normal assigned entries still work", async () => {
    expect((await request(app).get("/auth/me").set("Authorization", `Bearer ${token}`)).body.adjustmentPartyIds).toEqual([]);
    expect((await transfer(a, b)).status).toBe(403);
    expect((await request(app).post(`/parties/${a}/ledger-entries`).set("Authorization", `Bearer ${token}`)
      .send({ type: "YOU_GAVE", amount: 5 })).status).toBe(201);
  });

  it("requires both endpoint grants, denies forged cross-business IDs, and creates an atomic pair", async () => {
    expect((await patch({ adjustmentPartyIds: [a] })).status).toBe(200);
    expect((await transfer(a, b)).status).toBe(403);
    expect((await patch({ adjustmentPartyIds: [b] })).status).toBe(200);
    expect((await transfer(a, b)).status).toBe(403);
    expect((await patch({ adjustmentPartyIds: [a, foreign] })).status).toBe(400);
    expect((await patch({ adjustmentPartyIds: [a, b] })).status).toBe(200);
    expect((await transfer(a, foreign)).status).toBe(404);
    expect((await transfer(c, b)).status).toBe(403);
    expect((await transfer(a, a)).status).toBe(400);
    const success = await transfer(a, b);
    expect(success.status).toBe(201);
    const [counter] = await db.select().from(ledgerEntriesTable).where(eq(ledgerEntriesTable.id, success.body.linkedEntryId));
    expect(counter?.partyId).toBe(b);
    expect(counter?.linkedEntryId).toBe(success.body.id);
    expect(counter?.createdByUserId).toBe(staffId);
    expect((await request(app).get("/auth/me").set("Authorization", `Bearer ${token}`)).body.adjustmentPartyIds).toEqual([a, b]);
    const all = await request(app).get("/parties").set("Authorization", `Bearer ${token}`);
    expect(all.body.map((p: { id: string }) => p.id).sort()).toEqual([a, b, c].sort());
  });

  it("intersects grants on assignment edit, and explicit [] revokes adjustment without removing normal access", async () => {
    const trimmed = await patch({ partyIds: [a, c] });
    expect(trimmed.status).toBe(200);
    expect(trimmed.body.adjustmentPartyIds).toEqual([a]);
    expect((await transfer(a, b)).status).toBe(403);
    expect((await patch({ partyIds: [a, b, c], adjustmentPartyIds: [a, b] })).status).toBe(200);
    expect((await patch({ adjustmentPartyIds: [] })).status).toBe(200);
    expect((await transfer(a, b)).status).toBe(403);
    expect((await request(app).get(`/parties/${b}`).set("Authorization", `Bearer ${token}`)).status).toBe(200);
  });

  it("deletes staff from the list, revokes the same phone token, preserves ledger attribution, and permits explicit re-invite", async () => {
    expect((await request(app).delete(`/owner/workers/${staffId}`).set("Authorization", "Bearer owner").set("x-foreign", "1")).status).toBe(404);
    expect((await request(app).delete(`/owner/workers/${staffId}`).set("Authorization", `Bearer ${token}`)).status).toBe(403);
    expect((await request(app).delete(`/owner/workers/${staffId}`).set("Authorization", "Bearer owner")).status).toBe(204);
    expect((await request(app).get("/auth/me").set("Authorization", `Bearer ${token}`)).status).toBe(401);
    const list = await request(app).get("/owner/workers").set("Authorization", "Bearer owner");
    expect(list.body.workers.some((w: { id: string }) => w.id === staffId)).toBe(false);
    expect((await patch({ status: "active", partyIds: [a] })).status).toBe(404);
    const removed = await getOrCreatePhoneUser(phone);
    expect(removed.id).toBe(staffId);
    expect(removed.workerAccessDeletedAt).not.toBeNull();
    expect(removed.role).toBe("staff");
    expect((await db.select().from(ledgerEntriesTable).where(eq(ledgerEntriesTable.createdByUserId, staffId))).length).toBeGreaterThan(0);
    const reinvite = await request(app).post("/owner/workers").set("Authorization", "Bearer owner")
      .send({ phone, partyIds: [a, b], adjustmentPartyIds: [a, b] });
    expect(reinvite.status).toBe(201);
    expect((await request(app).get("/auth/me").set("Authorization", `Bearer ${token}`)).status).toBe(401);
    // This provisioning function is only called after successful OTP verification.
    const restored = await getOrCreatePhoneUser(phone);
    expect(restored.id).toBe(staffId);
    expect(restored.status).toBe("active");
    expect(restored.workerAccessDeletedAt).toBeNull();
    expect(restored.adjustmentPartyIds).toEqual([a, b]);
    expect((await request(app).get("/auth/me").set("Authorization", `Bearer ${token}`)).status).toBe(401);
    token = jwt.sign({ userId: staffId, phone, sessionVersion: restored.phoneSessionVersion }, process.env.SESSION_SECRET!, { expiresIn: "1h" });
    expect((await transfer(a, b)).status).toBe(201);
  });

  it("supports pending adjustment edits, deletes pending invites, and serializes claim versus delete", async () => {
    const create = await request(app).post("/owner/workers").set("Authorization", "Bearer owner")
      .send({ email, partyIds: [a, b], adjustmentPartyIds: [a, b] });
    expect(create.status).toBe(201);
    const inviteId = create.body.id;
    expect((await request(app).patch(`/owner/workers/${inviteId}`).set("Authorization", "Bearer owner")
      .send({ partyIds: [a] })).body.adjustmentPartyIds).toEqual([a]);
    expect((await request(app).delete(`/owner/workers/${inviteId}`).set("Authorization", "Bearer owner")).status).toBe(204);
    const [revoked] = await db.select().from(workerInvitesTable).where(eq(workerInvitesTable.id, inviteId));
    expect(revoked?.status).toBe("revoked");
    const again = await request(app).post("/owner/workers").set("Authorization", "Bearer owner")
      .send({ email, partyIds: [a, b], adjustmentPartyIds: [a, b] });
    expect(again.status).toBe(201);
    // Claim first, then stale pending-invite ID delete: it must remove claimed staff too.
    clerk.id = `worker-adjust-${crypto.randomUUID()}`;
    const claimed = await getOrCreateClerkUser(clerk.id, email);
    expect(claimed.adjustmentPartyIds).toEqual([a, b]);
    expect((await request(app).delete(`/owner/workers/${again.body.id}`).set("Authorization", "Bearer owner")).status).toBe(204);
    const [deleted] = await db.select().from(appUsersTable).where(eq(appUsersTable.id, claimed.id));
    expect(deleted?.workerAccessDeletedAt).not.toBeNull();
    expect((await getOrCreateClerkUser(clerk.id, email)).id).toBe(claimed.id);
  });

  it("does not let a revoked Clerk session consume a re-invitation or regain access", async () => {
    const [staff] = await db.select().from(appUsersTable).where(eq(appUsersTable.clerkUserId, clerk.id));
    await db.insert(appUserLoginSessionsTable).values({ userId: staff!.id, sessionId: "old-worker-session", revokedAt: new Date() });
    vi.stubEnv("CLERK_SECRET_KEY", "sk_test_local_fixture");
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => new Response(JSON.stringify(String(url).includes("/sessions/") ? {
      user_id: clerk.id,
      created_at: String(url).includes("unseen-old-session") ? 1 : Date.now() + 1000,
    } : {
      primary_email_address_id: "verified",
      email_addresses: [{ id: "verified", email_address: email, verification: { status: "verified" } }],
    })));
    const invitation = await request(app).post("/owner/workers").set("Authorization", "Bearer owner")
      .send({ email, partyIds: [a], adjustmentPartyIds: [] });
    expect(invitation.status).toBe(201);
    expect((await request(app).get("/auth/me").set("x-clerk-session", "old-worker-session")).status).toBe(401);
    expect((await request(app).get("/auth/me").set("x-clerk-session", "unseen-old-session")).status).toBe(401);
    const [pending] = await db.select().from(workerInvitesTable).where(eq(workerInvitesTable.id, invitation.body.id));
    expect(pending?.status).toBe("pending");
    const fresh = await request(app).get("/auth/me").set("x-clerk-session", "fresh-worker-session");
    expect(fresh.status).toBe(200);
    expect(fresh.body.adjustmentPartyIds).toEqual([]);
    expect((await request(app).get("/auth/me").set("x-clerk-session", "old-worker-session")).status).toBe(401);
    expect((await request(app).get("/auth/me").set("x-clerk-session", "unseen-old-session")).status).toBe(401);
  });

  it("serializes adjustment writes against grant removal and denies all writes after revoke commits", async () => {
    await patch({ partyIds: [a, b], adjustmentPartyIds: [a, b] });
    const [write, revoke] = await Promise.all([transfer(a, b), patch({ adjustmentPartyIds: [] })]);
    expect([201, 403]).toContain(write.status);
    expect(revoke.status).toBe(200);
    const before = await db.select({ id: ledgerEntriesTable.id }).from(ledgerEntriesTable)
      .where(inArray(ledgerEntriesTable.partyId, [a, b]));
    expect((await transfer(a, b)).status).toBe(403);
    const after = await db.select({ id: ledgerEntriesTable.id }).from(ledgerEntriesTable)
      .where(inArray(ledgerEntriesTable.partyId, [a, b]));
    expect(after.map((entry) => entry.id).sort()).toEqual(before.map((entry) => entry.id).sort());
    const refreshed = await request(app).get("/auth/me").set("Authorization", `Bearer ${token}`);
    expect(refreshed.status).toBe(200);
    expect(refreshed.body.adjustmentPartyIds).toEqual([]);
  });
});