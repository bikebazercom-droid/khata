import express, { type Request, type Response, type NextFunction } from "express";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  appUsersTable, businessSettingsTable, businessesTable, db, ledgerEntriesTable, partiesTable,
  userBusinessesTable, workerInvitesTable, workerPartyAssignmentsTable,
} from "@workspace/db";
import { eq, inArray } from "drizzle-orm";
import { getOrCreateClerkUser, type AuthenticatedRequest } from "../middlewares/requireAuth";
import ownerRouter from "./owner";

const makeApp = (businessId: string, role: "owner" | "staff" = "owner") => {
  const app = express();
  app.use(express.json());
  app.use((req: Request, _res: Response, next: NextFunction) => {
    const auth = req as unknown as AuthenticatedRequest;
    auth.businessId = businessId;
    auth.userId = "owner-test-user";
    auth.role = role;
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
  let staffId: string;
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
    const [staff] = await db.insert(appUsersTable).values({
      clerkUserId: `owner-activity-staff-${Date.now()}`,
      verifiedEmail: `activity-staff-${Date.now()}@example.test`,
      businessId,
      role: "staff",
      lastLogin: new Date("2025-01-02T03:04:05Z"),
      lastLogout: new Date("2025-01-03T03:04:05Z"),
    }).returning();
    staffId = staff!.id;
    await db.insert(workerPartyAssignmentsTable).values([
      { userId: staffId, partyId },
      { userId: staffId, partyId: otherPartyId },
    ]);
    await db.insert(ledgerEntriesTable).values([
      { partyId, createdByUserId: staffId, type: "YOU_GAVE", amount: "18.25", description: "Staff entry" },
      { partyId, createdByUserId: null, type: "YOU_GOT", amount: "1.00", description: "Actorless entry" },
      { partyId, createdByUserId: staffId, type: "YOU_GOT", amount: "2.00", description: "Transfer entry", isTransfer: true },
      { partyId: otherPartyId, createdByUserId: staffId, type: "YOU_GOT", amount: "3.00", description: "Other business entry" },
    ]);
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
    await db.delete(ledgerEntriesTable).where(inArray(ledgerEntriesTable.partyId, [partyId, otherPartyId]));
    await db.delete(workerPartyAssignmentsTable).where(eq(workerPartyAssignmentsTable.userId, staffId));
    await db.delete(appUsersTable).where(eq(appUsersTable.id, staffId));
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

  it("returns only recent normal staff-authored activity from the current business", async () => {
    const response = await request(makeApp(businessId)).get("/owner/activity");
    expect(response.status).toBe(200);
    expect(response.body.entries).toHaveLength(1);
    expect(response.body.entries[0]).toMatchObject({
      partyId,
      partyName: "Assigned",
      partyRole: "CUSTOMER",
      actorId: staffId,
      actorIdentity: expect.stringMatching(/activity-staff-/),
      type: "YOU_GAVE",
      amount: 18.25,
      description: "Staff entry",
    });
    expect(response.body.entries[0].createdAt).toEqual(expect.any(String));
  });

  it("bounds activity to 50 rows in descending creation order", async () => {
    const start = new Date("2999-02-01T00:00:00Z").getTime();
    await db.insert(ledgerEntriesTable).values(Array.from({ length: 52 }, (_, index) => ({
      partyId,
      createdByUserId: staffId,
      type: "YOU_GAVE" as const,
      amount: "1.00",
      description: `bounded-${index}`,
      createdAt: new Date(start + index * 1000),
    })));
    const response = await request(makeApp(businessId)).get("/owner/activity");
    expect(response.status).toBe(200);
    expect(response.body.entries).toHaveLength(50);
    expect(response.body.entries[0].description).toBe("bounded-51");
    expect(response.body.entries[49].description).toBe("bounded-2");
  });

  it("denies the staff role from owner-only endpoints", async () => {
    const response = await request(makeApp(businessId, "staff")).get("/owner/activity");
    expect(response.status).toBe(403);
  });

  it("includes login/logout timestamps and business-scoped assignments for workers", async () => {
    const response = await request(makeApp(businessId)).get("/owner/workers");
    expect(response.status).toBe(200);
    expect(response.body.workers).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: staffId,
        partyIds: [partyId],
        lastLogin: "2025-01-02T03:04:05.000Z",
        lastLogout: "2025-01-03T03:04:05.000Z",
      }),
      expect.objectContaining({
        identity: pendingEmail,
        status: "pending",
        invitedAt: expect.any(String),
      }),
    ]));
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