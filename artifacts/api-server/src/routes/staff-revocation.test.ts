import express, { type NextFunction, type Request, type Response } from "express";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import {
  appUsersTable, businessesTable, db, ledgerEntriesTable, partiesTable,
  workerPartyAssignmentsTable,
} from "@workspace/db";
import { type AuthenticatedRequest } from "../middlewares/requireAuth";
import { enforceRoleAccess } from "../middlewares/roleAccess";
import ownerRouter from "./owner";
import partiesRouter from "./parties";

describe("existing staff sessions after owner revocation", () => {
  let businessId: string;
  let foreignBusinessId: string;
  let partyId: string;
  let foreignPartyId: string;
  let ownerId: string;
  let staffId: string;

  beforeAll(async () => {
    const businesses = await db.insert(businessesTable).values([
      { name: "Staff revocation test" },
      { name: "Foreign revocation test" },
    ]).returning();
    businessId = businesses[0]!.id;
    foreignBusinessId = businesses[1]!.id;

    const parties = await db.insert(partiesTable).values([
      { businessId, name: "Assigned ledger", phone: "", role: "CUSTOMER" },
      { businessId: foreignBusinessId, name: "Foreign ledger", phone: "", role: "SUPPLIER" },
    ]).returning();
    partyId = parties[0]!.id;
    foreignPartyId = parties[1]!.id;

    const users = await db.insert(appUsersTable).values([
      { businessId, role: "owner", clerkUserId: `revocation-owner-${crypto.randomUUID()}` },
      {
        businessId, role: "staff", status: "active",
        clerkUserId: `revocation-staff-${crypto.randomUUID()}`,
        verifiedEmail: `revocation-${crypto.randomUUID()}@example.test`,
      },
    ]).returning();
    ownerId = users[0]!.id;
    staffId = users[1]!.id;
    await db.insert(workerPartyAssignmentsTable).values({ userId: staffId, partyId });
  });

  afterAll(async () => {
    if (!businessId) return;
    await db.delete(ledgerEntriesTable).where(eq(ledgerEntriesTable.partyId, partyId));
    await db.delete(workerPartyAssignmentsTable).where(eq(workerPartyAssignmentsTable.userId, staffId));
    await db.delete(appUsersTable).where(eq(appUsersTable.businessId, businessId));
    await db.delete(partiesTable).where(eq(partiesTable.id, partyId));
    await db.delete(partiesTable).where(eq(partiesTable.id, foreignPartyId));
    await db.delete(businessesTable).where(eq(businessesTable.id, businessId));
    await db.delete(businessesTable).where(eq(businessesTable.id, foreignBusinessId));
  });

  const app = express();
  app.use(express.json());
  // A stable bearer value models the SAME signed-in session for every request.
  // Read the identity on each request, as requireAuth does, rather than caching
  // its previous status or assignment in the test.
  app.use(async (req: Request, res: Response, next: NextFunction) => {
    const userId = req.get("Authorization") === "Bearer owner-session" ? ownerId
      : req.get("Authorization") === "Bearer staff-session" ? staffId : null;
    if (!userId) {
      res.status(401).end();
      return;
    }
    const [user] = await db.select().from(appUsersTable).where(eq(appUsersTable.id, userId));
    if (!user || user.status !== "active") {
      res.status(403).end();
      return;
    }
    const auth = req as AuthenticatedRequest;
    auth.userId = user.id;
    auth.businessId = user.businessId;
    auth.role = user.role;
    auth.status = user.status;
    auth.authMethod = "clerk";
    next();
  });
  app.use(enforceRoleAccess);
  app.use(ownerRouter);
  app.use(partiesRouter);

  const normalEntry = { type: "YOU_GAVE", amount: 18, description: "Customer payment" };
  const asStaff = () => request(app);
  const asOwner = () => request(app);

  it("removes read/write access immediately after assignment removal or suspension without deleting the owner's entry", async () => {
    const firstWrite = await asStaff().post(`/parties/${partyId}/ledger-entries`)
      .set("Authorization", "Bearer staff-session").send(normalEntry);
    expect(firstWrite.status).toBe(201);
    const initialRead = await asStaff().get(`/parties/${partyId}/ledger-entries`)
      .set("Authorization", "Bearer staff-session");
    expect(initialRead.status).toBe(200);
    expect(initialRead.body).toHaveLength(1);

    // Even an incorrectly persisted cross-business assignment must not make
    // another business' party accessible through the same staff session.
    await db.insert(workerPartyAssignmentsTable).values({ userId: staffId, partyId: foreignPartyId });
    const foreignRead = await asStaff().get(`/parties/${foreignPartyId}/ledger-entries`)
      .set("Authorization", "Bearer staff-session");
    const foreignWrite = await asStaff().post(`/parties/${foreignPartyId}/ledger-entries`)
      .set("Authorization", "Bearer staff-session").send(normalEntry);
    expect(foreignRead.status).toBe(404);
    expect(foreignWrite.status).toBe(404);
    const foreignEntries = await db.select().from(ledgerEntriesTable)
      .where(eq(ledgerEntriesTable.partyId, foreignPartyId));
    expect(foreignEntries).toHaveLength(0);

    const revoke = await asOwner().patch(`/owner/workers/${staffId}`)
      .set("Authorization", "Bearer owner-session").send({ partyIds: [] });
    expect(revoke.status).toBe(200);
    const revokedRead = await asStaff().get(`/parties/${partyId}/ledger-entries`)
      .set("Authorization", "Bearer staff-session");
    const revokedWrite = await asStaff().post(`/parties/${partyId}/ledger-entries`)
      .set("Authorization", "Bearer staff-session").send(normalEntry);
    expect(revokedRead.status).toBe(404);
    expect(revokedWrite.status).toBe(404);

    const restore = await asOwner().patch(`/owner/workers/${staffId}`)
      .set("Authorization", "Bearer owner-session").send({ partyIds: [partyId] });
    expect(restore.status).toBe(200);
    const restoredRead = await asStaff().get(`/parties/${partyId}/ledger-entries`)
      .set("Authorization", "Bearer staff-session");
    expect(restoredRead.status).toBe(200);

    const suspend = await asOwner().patch(`/owner/workers/${staffId}`)
      .set("Authorization", "Bearer owner-session").send({ status: "suspended" });
    expect(suspend.status).toBe(200);
    const suspendedRead = await asStaff().get(`/parties/${partyId}/ledger-entries`)
      .set("Authorization", "Bearer staff-session");
    const suspendedWrite = await asStaff().post(`/parties/${partyId}/ledger-entries`)
      .set("Authorization", "Bearer staff-session").send(normalEntry);
    expect(suspendedRead.status).toBe(403);
    expect(suspendedWrite.status).toBe(403);

    const ownerRead = await asOwner().get(`/parties/${partyId}/ledger-entries`)
      .set("Authorization", "Bearer owner-session");
    expect(ownerRead.status).toBe(200);
    expect(ownerRead.body).toHaveLength(1);
    const entries = await db.select().from(ledgerEntriesTable)
      .where(and(eq(ledgerEntriesTable.partyId, partyId), eq(ledgerEntriesTable.createdByUserId, staffId)));
    expect(entries).toHaveLength(1);
  });
});