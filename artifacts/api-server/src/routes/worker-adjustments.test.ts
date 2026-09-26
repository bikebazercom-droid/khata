import express, { type Request, type Response, type NextFunction } from "express";
import request from "supertest";
import jwt from "jsonwebtoken";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { and, eq, inArray } from "drizzle-orm";
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
  let businessId: string, foreignBusinessId: string, staffId: string, ownerId: string;
  let a: string, b: string, c: string, foreign: string;
  const email = `adjustments-${crypto.randomUUID()}@example.test`;
  const phone = `+88017${Math.floor(Math.random() * 100_000_000).toString().padStart(8, "0")}`;
  let token: string;
  const app = express();
  app.use(express.json());
  app.use(authRouter);
  app.use((req: Request, res: Response, next: NextFunction) => {
    if (req.get("Authorization") === "Bearer uuid-owner") {
      Object.assign(req as AuthenticatedRequest, {
        userId: ownerId, businessId: req.get("x-foreign") ? foreignBusinessId : businessId,
        role: "owner", status: "active", authMethod: "dev",
      });
      next();
      return;
    }
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
    const [owner] = await db.insert(appUsersTable).values({
      businessId, role: "owner", phone: `+88018${Math.floor(Math.random() * 100_000_000).toString().padStart(8, "0")}`,
    }).returning();
    ownerId = owner!.id;
    await db.insert(userBusinessesTable).values({ businessId, userId: staffId });
    await db.insert(userBusinessesTable).values({ businessId, userId: ownerId });
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
    expect((await transfer(a, foreign)).status).toBe(403);
    expect((await transfer(c, b)).status).toBe(403);
    expect((await transfer(a, a)).status).toBe(400);
    const success = await transfer(a, b);
    expect(success.status).toBe(201);
    expect(success.body.linkedEntryId).toBeNull();
    const [primary] = await db.select().from(ledgerEntriesTable).where(eq(ledgerEntriesTable.id, success.body.id));
    const [counter] = await db.select().from(ledgerEntriesTable).where(eq(ledgerEntriesTable.id, primary!.linkedEntryId!));
    expect(counter?.partyId).toBe(b);
    expect(counter?.linkedEntryId).toBe(success.body.id);
    expect(counter?.createdByUserId).toBe(staffId);
    expect((await request(app).get("/auth/me").set("Authorization", `Bearer ${token}`)).body.adjustmentPartyIds.sort()).toEqual([a, b].sort());
    const all = await request(app).get("/parties").set("Authorization", `Bearer ${token}`);
    expect(all.body.map((p: { id: string }) => p.id).sort()).toEqual([a, b, c].sort());
  });

  it("retains independent adjustment grants on assignment edit and explicit [] revokes them", async () => {
    const trimmed = await patch({ partyIds: [a, c] });
    expect(trimmed.status).toBe(200);
    expect(trimmed.body.adjustmentPartyIds).toEqual([a, b]);
    expect((await transfer(a, b)).status).toBe(201);
    expect((await patch({ partyIds: [a, b, c], adjustmentPartyIds: [a, b] })).status).toBe(200);
    expect((await patch({ adjustmentPartyIds: [] })).status).toBe(200);
    expect((await transfer(a, b)).status).toBe(403);
    expect((await request(app).get(`/parties/${b}`).set("Authorization", `Bearer ${token}`)).status).toBe(200);
  });

  it("offers adjustment-only counterparties without granting any balance or ledger visibility", async () => {
    expect((await patch({ partyIds: [a], adjustmentPartyIds: [a, b] })).status).toBe(200);
    const authorization = `Bearer ${token}`;
    const targets = await request(app).get("/adjustment-targets").set("Authorization", authorization);
    expect(targets.status).toBe(200);
    expect((await request(app).get("/auth/me").set("Authorization", authorization)).body.adjustmentPartyIds)
      .toEqual(expect.arrayContaining([a, b]));
    expect(targets.body).toEqual(expect.arrayContaining([
      { id: a, name: "A", role: "CUSTOMER" }, { id: b, name: "B", role: "CUSTOMER" },
    ]));
    expect(targets.body).toHaveLength(2);
    const list = await request(app).get("/parties").set("Authorization", authorization);
    expect(list.body.map((p: { id: string }) => p.id)).toEqual([a]);
    expect((await request(app).get("/parties?search=B").set("Authorization", authorization)).body).toEqual([]);
    expect((await request(app).get(`/parties/${b}`).set("Authorization", authorization)).status).toBe(404);
    expect((await request(app).get(`/parties/${b}/ledger-entries`).set("Authorization", authorization)).status).toBe(404);
    expect((await request(app).get("/dashboard/summary").set("Authorization", authorization)).status).toBe(403);
    expect((await transfer(c, b)).status).toBe(404);
    expect((await transfer(a, c)).status).toBe(403);
    const result = await transfer(a, b);
    expect(result.status).toBe(201);
    expect(result.body.transferPartyId).toBe(b);
    expect(result.body.linkedEntryId).toBeNull();
    expect(JSON.stringify(result.body)).not.toMatch(/currentBalance|balanceType/);
    const source = await request(app).get(`/parties/${a}/ledger-entries`).set("Authorization", authorization);
    expect(source.status).toBe(200);
    expect(source.body.find((entry: { id: string }) => entry.id === result.body.id)?.linkedEntryId).toBeNull();
    expect((await patch({ adjustmentPartyIds: [a] })).status).toBe(200);
    expect((await transfer(a, b)).status).toBe(403);
    expect((await request(app).get("/adjustment-targets").set("Authorization", authorization)).body)
      .toEqual([{ id: a, name: "A", role: "CUSTOMER" }]);
    expect((await request(app).patch(`/parties/${b}/ledger-entries/${result.body.id}`).set("Authorization", authorization)
      .send({ amount: 99 })).status).toBe(403);
    expect((await request(app).delete(`/parties/${b}/entries/${result.body.id}`).set("Authorization", authorization)).status).toBe(403);
  });

  it("keeps both sides and balances synchronized when an owner edits or deletes a transfer", async () => {
    const owner = () => request(app);
    const before = await db.select().from(partiesTable).where(inArray(partiesTable.id, [a, b]));
    const first = await owner().post(`/parties/${a}/ledger-entries`).set("Authorization", "Bearer owner")
      .send({ type: "YOU_GAVE", amount: 13, isTransfer: true, transferPartyId: b });
    expect(first.status).toBe(201);
    const edited = await owner().patch(`/parties/${a}/ledger-entries/${first.body.id}`)
      .set("Authorization", "Bearer owner").send({ type: "YOU_GOT", amount: 19 });
    expect(edited.status).toBe(200);
    const [counter] = await db.select().from(ledgerEntriesTable)
      .where(eq(ledgerEntriesTable.id, first.body.linkedEntryId));
    expect(counter?.type).toBe("YOU_GAVE");
    expect(Number(counter?.amount)).toBe(19);
    expect((await owner().delete(`/parties/${a}/entries/${first.body.id}`)
      .set("Authorization", "Bearer owner")).status).toBe(200);
    expect(await db.select().from(ledgerEntriesTable).where(inArray(ledgerEntriesTable.id,
      [first.body.id, first.body.linkedEntryId]))).toEqual([]);
    const after = await db.select().from(partiesTable).where(inArray(partiesTable.id, [a, b]));
    for (const old of before) {
      const current = after.find((p) => p.id === old.id)!;
      expect(current.currentBalance).toBe(old.currentBalance);
      expect(current.balanceType).toBe(old.balanceType);
    }
  });

  it("atomically deduplicates concurrent normal entries, scopes keys by actor/business, and never recreates a deleted entry", async () => {
    expect((await patch({ partyIds: [a, b, c], adjustmentPartyIds: [a, b] })).status).toBe(200);
    const key = crypto.randomUUID();
    const payload = { clientRequestId: key, type: "YOU_GAVE", amount: 23, description: "offline normal" };
    const send = (auth: string, source = a, body = payload, foreignHeader = false) => {
      let req = request(app).post(`/parties/${source}/ledger-entries`).set("Authorization", auth);
      if (foreignHeader) req = req.set("x-foreign", "1");
      return req.send(body);
    };
    const [first, second] = await Promise.all([send("Bearer owner"), send("Bearer owner")]);
    expect([first.status, second.status].sort()).toEqual([200, 201]);
    expect(first.body.id).toBe(second.body.id);
    expect((await db.select().from(ledgerEntriesTable).where(eq(ledgerEntriesTable.id, first.body.id)))).toHaveLength(1);
    expect((await send("Bearer owner", a, { ...payload, amount: 24 })).status).toBe(409);
    const otherActor = await send(`Bearer ${token}`);
    expect(otherActor.status, JSON.stringify(otherActor.body)).toBe(201);
    expect(otherActor.body.id).not.toBe(first.body.id);
    const otherBusiness = await send("Bearer owner", foreign, payload, true);
    expect(otherBusiness.status).toBe(201);
    expect(otherBusiness.body.id).not.toBe(first.body.id);
    expect((await request(app).delete(`/parties/${a}/entries/${first.body.id}`)
      .set("Authorization", "Bearer owner")).status).toBe(200);
    const replay = await send("Bearer owner");
    expect(replay.status).toBe(200);
    expect(replay.body.id).toBe(first.body.id);
    expect((await db.select().from(ledgerEntriesTable).where(eq(ledgerEntriesTable.id, first.body.id)))).toHaveLength(0);
  });

  it("checks a real owner's current business membership before any receipt replay", async () => {
    const requestId = crypto.randomUUID();
    const send = () => request(app).post(`/parties/${foreign}/ledger-entries`)
      .set("Authorization", "Bearer uuid-owner").set("x-foreign", "1")
      .send({ clientRequestId: requestId, type: "YOU_GAVE", amount: 4 });
    expect((await send()).status).toBe(403);
    await db.insert(userBusinessesTable).values({ userId: ownerId, businessId: foreignBusinessId });
    const first = await send();
    expect(first.status).toBe(201);
    expect((await send()).status).toBe(200);
    await db.delete(userBusinessesTable).where(and(
      eq(userBusinessesTable.userId, ownerId), eq(userBusinessesTable.businessId, foreignBusinessId)));
    expect((await send()).status).toBe(403);
    expect((await db.select().from(ledgerEntriesTable).where(eq(ledgerEntriesTable.id, first.body.id)))).toHaveLength(1);
  });

  it("retries a staff transfer as the same atomic pair, conceals the target link, and denies replay after grant revocation", async () => {
    expect((await patch({ partyIds: [a, b, c], adjustmentPartyIds: [a, b] })).status).toBe(200);
    const key = crypto.randomUUID();
    const payload = { clientRequestId: key, type: "YOU_GOT", amount: 17,
      isTransfer: true, transferPartyId: b };
    const send = () => request(app).post(`/parties/${a}/ledger-entries`)
      .set("Authorization", `Bearer ${token}`).send(payload);
    const first = await send();
    const replay = await send();
    expect(first.status, JSON.stringify(first.body)).toBe(201);
    expect(replay.status).toBe(200);
    expect(replay.body.id).toBe(first.body.id);
    expect(replay.body.linkedEntryId).toBeNull();
    const [source] = await db.select().from(ledgerEntriesTable).where(eq(ledgerEntriesTable.id, first.body.id));
    expect(source?.linkedEntryId).toBeTruthy();
    expect((await db.select().from(ledgerEntriesTable).where(eq(ledgerEntriesTable.id, source!.linkedEntryId!)))).toHaveLength(1);
    expect((await patch({ adjustmentPartyIds: [a] })).status).toBe(200);
    expect((await send()).status).toBe(403);
    expect((await request(app).post(`/parties/${a}/ledger-entries`).set("Authorization", `Bearer ${token}`)
      .send({ ...payload, clientRequestId: crypto.randomUUID() })).status).toBe(403);
    expect((await db.select().from(ledgerEntriesTable).where(eq(ledgerEntriesTable.id, first.body.id)))).toHaveLength(1);
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
      .send({ email, partyIds: [a], adjustmentPartyIds: [a, b] });
    expect(create.status).toBe(201);
    const inviteId = create.body.id;
    expect(create.body.adjustmentPartyIds).toEqual([a, b]);
    expect((await request(app).patch(`/owner/workers/${inviteId}`).set("Authorization", "Bearer owner")
      .send({ partyIds: [a] })).body.adjustmentPartyIds).toEqual([a, b]);
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
      id: String(url).split("/").at(-1),
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

  it.each([
    ["timeout rejection", 500],
    ["never headers", 500],
    ["stalled JSON", 500],
    ["user never headers", 500],
    ["user stalled JSON", 500],
    ["user unavailable", 500],
    ["rate limited", 500],
    ["unavailable", 500],
    ["invalid JSON", 500],
    ["null response", 401],
    ["array response", 401],
    ["overflow created_at", 401],
    ["missing created_at", 401],
    ["null created_at", 401],
    ["string created_at", 401],
    ["boolean created_at", 401],
    ["missing id", 401],
    ["numeric id", 401],
    ["wrong id", 401],
    ["missing user_id", 401],
    ["numeric user_id", 401],
    ["wrong user_id", 401],
    ["at cutoff", 401],
  ] as const)("fails closed on %s and recovers without reviving old sessions", async (failure, status) => {
    const previousClerkId = clerk.id;
    const identity = `provider-failure-${crypto.randomUUID()}`;
    const fixtureEmail = `${identity}@example.test`;
    let userId: string | undefined;
    let inviteId: string | undefined;
    let recovered = false;
    let cutoff = 0;
    let releaseLate: (() => void) | undefined;
    let metadataSignal: AbortSignal | undefined;
    const known = `${identity}-known`;
    const unseen = `${identity}-unseen`;
    const fresh = `${identity}-fresh`;
    clerk.id = identity;
    vi.stubEnv("CLERK_SECRET_KEY", "sk_test_local_fixture");
    // No passthrough: every provider request must match this isolated identity.
      const provider = vi.spyOn(globalThis, "fetch").mockImplementation(async (url, options) => {
      if (String(url) === `https://api.clerk.com/v1/users/${identity}`) {
          const userMetadata = {
          primary_email_address_id: "verified",
          email_addresses: [{ id: "verified", email_address: fixtureEmail, verification: { status: "verified" } }],
          };
          if (!recovered && failure === "user unavailable") return new Response("unavailable", { status: 503 });
          if (!recovered && failure === "user never headers") {
            metadataSignal = options?.signal as AbortSignal;
            return new Promise<globalThis.Response>((resolve) => {
              releaseLate = () => resolve(new Response(JSON.stringify(userMetadata)));
            });
          }
          if (!recovered && failure === "user stalled JSON") {
            metadataSignal = options?.signal as AbortSignal;
            return {
              ok: true,
              json: () => new Promise((resolve) => {
                releaseLate = () => resolve(userMetadata);
              }),
            } as unknown as globalThis.Response;
          }
          return new Response(JSON.stringify(userMetadata));
      }
      expect(String(url)).toMatch(new RegExp(`^https://api.clerk.com/v1/sessions/${identity}-(fresh|unseen)$`));
      const sessionId = String(url).split("/").at(-1)!;
      const session: Record<string, unknown> = {
        id: sessionId, user_id: identity, created_at: sessionId === unseen ? cutoff - 1 : cutoff + 1000,
      };
      if (!recovered && sessionId === fresh) {
        if (failure === "never headers") {
          metadataSignal = options?.signal as AbortSignal;
          return new Promise<globalThis.Response>((resolve) => {
            releaseLate = () => resolve(new Response(JSON.stringify(session)));
          });
        }
        if (failure === "stalled JSON") {
          metadataSignal = options?.signal as AbortSignal;
          return {
            ok: true,
            json: () => new Promise((resolve) => {
              releaseLate = () => resolve(session);
            }),
          } as unknown as globalThis.Response;
        }
        if (failure === "timeout rejection") throw new DOMException("Fixture timeout", "TimeoutError");
        if (failure === "rate limited") return new Response("rate limited", { status: 429 });
        if (failure === "unavailable") return new Response("unavailable", { status: 503 });
        if (failure === "invalid JSON") return new Response("{");
        if (failure === "null response") return new Response("null");
        if (failure === "array response") return new Response("[]");
        if (failure === "overflow created_at") {
          return new Response(`{"id":"${sessionId}","user_id":"${identity}","created_at":1e400}`);
        }
        if (failure === "missing created_at") delete session.created_at;
        if (failure === "null created_at") session.created_at = null;
        if (failure === "string created_at") session.created_at = String(cutoff + 1000);
        if (failure === "boolean created_at") session.created_at = true;
        if (failure === "missing id") delete session.id;
        if (failure === "numeric id") session.id = 123;
        if (failure === "wrong id") session.id = "another-session";
        if (failure === "missing user_id") delete session.user_id;
        if (failure === "numeric user_id") session.user_id = 123;
        if (failure === "wrong user_id") session.user_id = "another-user";
        if (failure === "at cutoff") session.created_at = cutoff;
      }
      return new Response(JSON.stringify(session));
    });
    try {
      const created = await request(app).post("/owner/workers").set("Authorization", "Bearer owner")
        .send({ email: fixtureEmail, partyIds: [a, b], adjustmentPartyIds: [a, b] });
      expect(created.status).toBe(201);
      const worker = await getOrCreateClerkUser(identity, fixtureEmail);
      userId = worker.id;
      await db.insert(appUserLoginSessionsTable).values({ userId, sessionId: known });
      expect((await request(app).delete(`/owner/workers/${userId}`).set("Authorization", "Bearer owner")).status).toBe(204);
      const sessions = await db.select().from(appUserLoginSessionsTable).where(eq(appUserLoginSessionsTable.userId, userId));
      cutoff = sessions.find((s) => s.sessionId === "worker-access-revoked")!.revokedAt!.getTime();
      const invited = await request(app).post("/owner/workers").set("Authorization", "Bearer owner")
        .send({ email: fixtureEmail, partyIds: [a, b], adjustmentPartyIds: [a, b] });
      expect(invited.status).toBe(201);
      inviteId = invited.body.id;
      const ledger = () => db.select().from(ledgerEntriesTable).where(inArray(ledgerEntriesTable.partyId, [a, b]));
      const before = await ledger();
      const memberships = await db.select().from(userBusinessesTable).where(eq(userBusinessesTable.userId, userId));
      const write = (session: string) => request(app).post(`/parties/${a}/ledger-entries`)
        .set("x-clerk-session", session).send({ type: "YOU_GAVE", amount: 10, isTransfer: true, transferPartyId: b });
      for (const session of [fresh, known, unseen]) {
        const timed = session === fresh && (
          failure === "never headers" || failure === "stalled JSON" ||
          failure === "user never headers" || failure === "user stalled JSON"
        );
        if (timed) vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
        let denied: { status: number; body: { error: string } };
        try {
          if (timed) {
            const pending = write(session).then((result) => result);
            // Fake only the provider timeout. DB/socket I/O is real; a fixed
            // count of event-loop turns can finish before the request reaches
            // the mocked provider when the test runner or DB is busy.
            const providerDeadline = process.hrtime.bigint() + 10_000_000_000n;
            while (!releaseLate && process.hrtime.bigint() < providerDeadline) {
              await vi.advanceTimersByTimeAsync(0);
              await new Promise<void>((resolve) => setImmediate(resolve));
            }
            expect(releaseLate, `provider calls: ${provider.mock.calls.map(([url]) => String(url)).join(", ")}`).toBeDefined();
            await vi.advanceTimersByTimeAsync(5_000);
            denied = await pending;
            expect(metadataSignal?.aborted).toBe(true);
          } else {
            denied = await write(session);
          }
        } finally {
          if (timed) vi.useRealTimers();
        }
        expect(denied.status).toBe(session === fresh ? status : 401);
        expect(denied.body.error).toEqual(expect.any(String));
        const [pending] = await db.select().from(workerInvitesTable).where(eq(workerInvitesTable.id, inviteId!));
        expect(pending?.status).toBe("pending");
        const [deleted] = await db.select().from(appUsersTable).where(eq(appUsersTable.id, userId));
        expect(deleted?.status).toBe("suspended");
        expect(deleted?.workerAccessDeletedAt).not.toBeNull();
        expect(deleted?.adjustmentPartyIds).toEqual([]);
        expect(await db.select().from(workerPartyAssignmentsTable).where(eq(workerPartyAssignmentsTable.userId, userId))).toEqual([]);
        expect(await db.select().from(userBusinessesTable).where(eq(userBusinessesTable.userId, userId))).toEqual(memberships);
        expect(await ledger()).toEqual(before);
        if (timed) {
          releaseLate!();
          await new Promise<void>((resolve) => setImmediate(resolve));
          expect((await db.select().from(workerInvitesTable).where(eq(workerInvitesTable.id, inviteId!)))[0]?.status).toBe("pending");
          expect(await ledger()).toEqual(before);
        }
      }
      expect(provider).toHaveBeenCalledWith(`https://api.clerk.com/v1/sessions/${fresh}`, expect.any(Object));
      recovered = true;
      expect((await write(fresh)).status).toBe(201);
      const [claimed] = await db.select().from(workerInvitesTable).where(eq(workerInvitesTable.id, inviteId!));
      expect(claimed?.status).toBe("claimed");
      const afterRecovery = await ledger();
      expect(afterRecovery.length).toBe(before.length + 2);
      for (const session of [known, unseen]) expect((await write(session)).status).toBe(401);
      expect(await ledger()).toEqual(afterRecovery);
      expect((await request(app).get("/auth/me").set("x-clerk-session", fresh)).status).toBe(200);
    } finally {
      vi.useRealTimers();
      provider.mockRestore();
      clerk.id = previousClerkId;
      // Cleanup also runs on assertion failures; no fixture identity survives a case.
      await db.delete(workerInvitesTable).where(eq(workerInvitesTable.email, fixtureEmail));
      if (userId) {
        await db.delete(ledgerEntriesTable).where(eq(ledgerEntriesTable.createdByUserId, userId));
        await db.delete(workerPartyAssignmentsTable).where(eq(workerPartyAssignmentsTable.userId, userId));
        await db.delete(userBusinessesTable).where(eq(userBusinessesTable.userId, userId));
        await db.delete(appUserLoginSessionsTable).where(eq(appUserLoginSessionsTable.userId, userId));
        await db.delete(appUsersTable).where(eq(appUsersTable.id, userId));
      }
    }
  });
});