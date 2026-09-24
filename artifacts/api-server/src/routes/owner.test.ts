import express, { type Request, type Response, type NextFunction } from "express";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  appUsersTable, businessSettingsTable, businessesTable, db, partiesTable,
  userBusinessesTable, workerInvitesTable, workerPartyAssignmentsTable,
} from "@workspace/db";
import { eq, inArray } from "drizzle-orm";
import { getOrCreateClerkUser, type AuthenticatedRequest } from "../middlewares/requireAuth";
import ownerRouter from "./owner";

const makeApp = (businessId: string) => {
  const app = express();
  app.use(express.json());
  app.use((req: Request, _res: Response, next: NextFunction) => {
    const auth = req as unknown as AuthenticatedRequest;
    auth.businessId = businessId;
    auth.userId = "owner-test-user";
    auth.role = "owner";
    auth.status = "active";
    auth.authMethod = "dev";
    next();
  });
  app.use(ownerRouter);
  return app;
};

describe("owner worker invitation authorization", () => {
  let businessId: string;
  let otherBusinessId: string;
  let partyId: string;
  let otherPartyId: string;
  let inviteId: string;
  const linkedEmail = `linked-${Date.now()}@example.test`;
  const pendingEmail = `pending-${Date.now()}@example.test`;

  beforeAll(async () => {
    const [business, otherBusiness] = await db.insert(businessesTable)
      .values([{ name: "Owner invite test" }, { name: "Other business" }]).returning();
    businessId = business!.id;
    otherBusinessId = otherBusiness!.id;
    const [party, otherParty] = await db.insert(partiesTable).values([
      { businessId, name: "Assigned", phone: "", role: "CUSTOMER" },
      { businessId: otherBusinessId, name: "Foreign", phone: "", role: "CUSTOMER" },
    ]).returning();
    partyId = party!.id;
    otherPartyId = otherParty!.id;
    const [invite] = await db.insert(workerInvitesTable).values({
      businessId, email: pendingEmail, partyIds: [partyId],
    }).returning();
    inviteId = invite!.id;
    await db.insert(workerInvitesTable).values({
      businessId: otherBusinessId,
      email: `pending-elsewhere-${Date.now()}@example.test`,
    });
    await db.insert(appUsersTable).values({
      clerkUserId: `owner-invite-test-${Date.now()}`,
      verifiedEmail: linkedEmail,
      businessId: otherBusinessId,
      role: "owner",
    });
  });

  afterAll(async () => {
    await db.delete(workerInvitesTable).where(inArray(workerInvitesTable.businessId, [businessId, otherBusinessId]));
    await db.delete(appUsersTable).where(eq(appUsersTable.businessId, otherBusinessId));
    await db.delete(partiesTable).where(inArray(partiesTable.id, [partyId, otherPartyId]));
    await db.delete(businessesTable).where(inArray(businessesTable.id, [businessId, otherBusinessId]));
  });

  it("rejects pending invite assignments outside the owner's business without changing the invite", async () => {
    const app = makeApp(businessId);
    const response = await request(app).patch(`/owner/workers/${inviteId}`)
      .send({ partyIds: [otherPartyId] });
    expect(response.status).toBe(400);
    const [invite] = await db.select().from(workerInvitesTable).where(eq(workerInvitesTable.id, inviteId));
    expect(invite?.partyIds).toEqual([partyId]);
  });

  it("revokes an invite and prevents invitations for identities already linked elsewhere", async () => {
    const app = makeApp(businessId);
    const revoke = await request(app).patch(`/owner/workers/${inviteId}`)
      .send({ status: "suspended" });
    expect(revoke.status).toBe(200);
    expect(revoke.body.status).toBe("revoked");

    const duplicate = await request(app).post("/owner/workers")
      .send({ email: linkedEmail, partyIds: [] });
    expect(duplicate.status).toBe(409);
    expect(duplicate.body.error).toBe("This identity cannot be invited");
  });

  it("rejects a pending email invitation regardless of business and disables phone invites", async () => {
    const app = makeApp(businessId);
    const otherPending = await db.insert(workerInvitesTable).values({
      businessId: otherBusinessId,
      email: `cross-business-${Date.now()}@example.test`,
    }).returning();
    const conflict = await request(app).post("/owner/workers")
      .send({ email: otherPending[0]!.email, partyIds: [] });
    const phone = await request(app).post("/owner/workers")
      .send({ phone: "01712345678", partyIds: [] });
    expect(conflict.status).toBe(409);
    expect(phone.status).toBe(503);
    const phoneInvites = await db.select().from(workerInvitesTable)
      .where(eq(workerInvitesTable.phone, "+8801712345678"));
    expect(phoneInvites).toHaveLength(0);
    await db.delete(workerInvitesTable).where(eq(workerInvitesTable.id, otherPending[0]!.id));
  });

  it("serializes simultaneous invitation creation for a globally unique pending identity", async () => {
    const email = `race-create-${Date.now()}@example.test`;
    const [left, right] = await Promise.all([
      request(makeApp(businessId)).post("/owner/workers").send({ email, partyIds: [] }),
      request(makeApp(otherBusinessId)).post("/owner/workers").send({ email, partyIds: [] }),
    ]);
    expect([left.status, right.status].filter((status) => status === 201)).toHaveLength(1);
    expect([left.status, right.status].filter((status) => status === 409)).toHaveLength(1);
    const created = await db.select().from(workerInvitesTable).where(eq(workerInvitesTable.email, email));
    expect(created).toHaveLength(1);
    await db.delete(workerInvitesTable).where(eq(workerInvitesTable.email, email));
  });

  it("linearizes an invite claim against revocation and records the claimant", async () => {
    const email = `claim-race-${Date.now()}@example.test`;
    const [invite] = await db.insert(workerInvitesTable).values({
      businessId, email, partyIds: [partyId],
    }).returning();
    const clerkUserId = `claim-race-${Date.now()}`;
    const [claimResult, revokeResponse] = await Promise.all([
      getOrCreateClerkUser(clerkUserId, email),
      request(makeApp(businessId)).patch(`/owner/workers/${invite!.id}`).send({ status: "suspended" }),
    ]);
    const [finalInvite] = await db.select().from(workerInvitesTable).where(eq(workerInvitesTable.id, invite!.id));
    if (finalInvite!.status === "claimed") {
      expect(finalInvite!.claimedUserId).toBe(claimResult.id);
      expect(claimResult.role).toBe("staff");
      expect(revokeResponse.status).toBe(409);
      expect(revokeResponse.body.workerId).toBe(claimResult.id);
    } else {
      expect(finalInvite!.status).toBe("revoked");
      expect(revokeResponse.status).toBe(200);
      expect(claimResult.role).toBe("owner");
    }

    await db.delete(workerPartyAssignmentsTable).where(eq(workerPartyAssignmentsTable.userId, claimResult.id));
    await db.delete(userBusinessesTable).where(eq(userBusinessesTable.userId, claimResult.id));
    await db.delete(appUsersTable).where(eq(appUsersTable.id, claimResult.id));
    if (claimResult.businessId !== businessId) {
      await db.delete(businessSettingsTable).where(eq(businessSettingsTable.businessId, claimResult.businessId));
      await db.delete(businessesTable).where(eq(businessesTable.id, claimResult.businessId));
    }
    await db.delete(workerInvitesTable).where(eq(workerInvitesTable.id, invite!.id));
  });
});