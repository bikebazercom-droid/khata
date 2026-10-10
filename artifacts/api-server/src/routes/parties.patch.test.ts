/**
 * Integration tests for PATCH /parties/:partyId/ledger-entries/:entryId
 * — bill photo cleanup on replacement
 *
 * These tests run against a real Postgres schema (DATABASE_URL).  Each suite
 * uses a freshly-created business UUID so rows are fully isolated.
 *
 * Covered scenarios
 * ─────────────────
 * 1. Replacing a photo → the old /objects/ path is deleted from storage
 * 2. Nulling out a photo → the old /objects/ path is deleted from storage
 * 3. Storage failure → PATCH still returns 200 with the updated entry
 * 4. billImage field absent from body → storage not called
 * 5. billImage set to the same value → storage not called
 * 6. Entry had no previous photo → storage not called
 */

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import express, { type Request, type Response, type NextFunction } from "express";
import request from "supertest";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "@workspace/db";
import { partiesTable, ledgerEntriesTable, businessesTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import partiesRouter from "./parties";
import type { AuthenticatedRequest } from "../middlewares/requireAuth";

// ─── Setup ───────────────────────────────────────────────────────────────────

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL must be set to run integration tests");
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const testDb = drizzle(pool, { schema });

function makeApp(businessId: string) {
  const app = express();
  app.use(express.json());
  app.use((req: Request, _res: Response, next: NextFunction) => {
    (req as unknown as AuthenticatedRequest).businessId = businessId;
    (req as unknown as AuthenticatedRequest).userId = "test-user";
    (req as unknown as AuthenticatedRequest).role = "owner";
    next();
  });
  app.use(partiesRouter);
  return app;
}

let businessId: string;

beforeAll(async () => {
  const [biz] = await testDb
    .insert(businessesTable)
    .values({ name: "Patch Photo Test Business" })
    .returning();
  businessId = biz!.id;
});

afterAll(async () => {
  await testDb.delete(partiesTable).where(eq(partiesTable.businessId, businessId));
  await testDb.delete(businessesTable).where(eq(businessesTable.id, businessId));
  await pool.end();
});

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function createParty(
  name: string,
  currentBalance = "100.00",
  role: "CUSTOMER" | "SUPPLIER" = "CUSTOMER",
) {
  const [party] = await testDb
    .insert(partiesTable)
    .values({
      businessId,
      name,
      phone: "",
      role,
      currentBalance,
      balanceType: "YOU_WILL_GET",
    })
    .returning();
  return party!;
}

async function createEntry(partyId: string, billImage: string | null = null) {
  const [entry] = await testDb
    .insert(ledgerEntriesTable)
    .values({
      partyId,
      type: "YOU_GAVE",
      amount: "50.00",
      description: "patch photo test entry",
      billImage,
    })
    .returning();
  return entry!;
}

async function fetchEntry(id: string) {
  const [row] = await testDb
    .select()
    .from(ledgerEntriesTable)
    .where(eq(ledgerEntriesTable.id, id));
  return row ?? null;
}

async function fetchParty(id: string) {
  const [row] = await testDb.select().from(partiesTable).where(eq(partiesTable.id, id));
  return row ?? null;
}

function signedBalance(party: NonNullable<Awaited<ReturnType<typeof fetchParty>>>) {
  const amount = Number(party.currentBalance);
  return party.balanceType === "YOU_WILL_GET" ? amount : -amount;
}

async function createTransferPair(sourcePartyId: string, targetPartyId: string, amount = "50.00") {
  const [primary] = await testDb.insert(ledgerEntriesTable).values({
    partyId: sourcePartyId,
    type: "YOU_GAVE",
    amount,
    description: "adjusted with target",
    isTransfer: true,
    transferPartyId: targetPartyId,
  }).returning();
  const [counter] = await testDb.insert(ledgerEntriesTable).values({
    partyId: targetPartyId,
    type: "YOU_GOT",
    amount,
    description: "adjusted with source",
    isTransfer: true,
    transferPartyId: sourcePartyId,
    linkedEntryId: primary!.id,
  }).returning();
  const [linkedPrimary] = await testDb.update(ledgerEntriesTable)
    .set({ linkedEntryId: counter!.id })
    .where(eq(ledgerEntriesTable.id, primary!.id))
    .returning();
  return { primary: linkedPrimary!, counter: counter! };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("PATCH ledger-entry — bill photo replacement cleanup", () => {
  it("deletes the old /objects/ path when billImage is replaced with a new value", async () => {
    const { ObjectStorageService } = await import("../lib/objectStorage");
    const deleteSpy = vi
      .spyOn(ObjectStorageService.prototype, "deleteObjectEntity")
      .mockResolvedValue(undefined);

    const party = await createParty("Replace Photo Party");
    const entry = await createEntry(party.id, "/objects/uploads/old-uuid");

    const app = makeApp(businessId);
    const res = await request(app)
      .patch(`/parties/${party.id}/ledger-entries/${entry.id}`)
      .send({ billImage: "/objects/uploads/new-uuid" })
      .expect(200);

    // Response must reflect the new billImage.
    expect(res.body.billImage).toBe("/objects/uploads/new-uuid");

    // Storage must have been asked to delete the OLD path exactly once.
    expect(deleteSpy).toHaveBeenCalledTimes(1);
    expect(deleteSpy).toHaveBeenCalledWith("/objects/uploads/old-uuid");

    // DB must now hold the new path.
    const updated = await fetchEntry(entry.id);
    expect(updated?.billImage).toBe("/objects/uploads/new-uuid");

    vi.restoreAllMocks();
  });

  it("deletes the old /objects/ path when billImage is set to null (removed)", async () => {
    const { ObjectStorageService } = await import("../lib/objectStorage");
    const deleteSpy = vi
      .spyOn(ObjectStorageService.prototype, "deleteObjectEntity")
      .mockResolvedValue(undefined);

    const party = await createParty("Null Out Photo Party");
    const entry = await createEntry(party.id, "/objects/uploads/to-remove-uuid");

    const app = makeApp(businessId);
    const res = await request(app)
      .patch(`/parties/${party.id}/ledger-entries/${entry.id}`)
      .send({ billImage: null })
      .expect(200);

    // Response must reflect null billImage.
    expect(res.body.billImage).toBeNull();

    // Storage must have been asked to delete the old path.
    expect(deleteSpy).toHaveBeenCalledTimes(1);
    expect(deleteSpy).toHaveBeenCalledWith("/objects/uploads/to-remove-uuid");

    // DB must now hold null.
    const updated = await fetchEntry(entry.id);
    expect(updated?.billImage).toBeNull();

    vi.restoreAllMocks();
  });

  it("still returns 200 with the updated entry when storage deletion fails", async () => {
    const { ObjectStorageService } = await import("../lib/objectStorage");
    vi.spyOn(ObjectStorageService.prototype, "deleteObjectEntity").mockRejectedValue(
      new Error("storage unavailable"),
    );

    const party = await createParty("Storage Fail Patch Party");
    const entry = await createEntry(party.id, "/objects/uploads/fail-uuid");

    const app = makeApp(businessId);
    const res = await request(app)
      .patch(`/parties/${party.id}/ledger-entries/${entry.id}`)
      .send({ billImage: "/objects/uploads/replacement-uuid" })
      .expect(200);

    // Response must still be the updated entry.
    expect(res.body.billImage).toBe("/objects/uploads/replacement-uuid");

    // DB must reflect the new value despite the storage error.
    const updated = await fetchEntry(entry.id);
    expect(updated?.billImage).toBe("/objects/uploads/replacement-uuid");

    vi.restoreAllMocks();
  });

  it("calls req.log.error with the objectPath when storage deletion fails", async () => {
    const { ObjectStorageService } = await import("../lib/objectStorage");
    vi.spyOn(ObjectStorageService.prototype, "deleteObjectEntity").mockRejectedValue(
      new Error("storage unavailable"),
    );

    const logError = vi.fn();

    // Build an app that attaches a mock logger to req so we can spy on
    // req.log.error calls that happen inside the fire-and-forget .catch().
    const appWithLogger = express();
    appWithLogger.use(express.json());
    appWithLogger.use((req: Request, _res: Response, next: NextFunction) => {
      (req as unknown as AuthenticatedRequest).businessId = businessId;
      (req as unknown as AuthenticatedRequest).userId = "test-user";
      (req as unknown as AuthenticatedRequest).role = "owner";
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (req as any).log = { error: logError };
      next();
    });
    appWithLogger.use(partiesRouter);

    const party = await createParty("Log Error Patch Party");
    const entry = await createEntry(party.id, "/objects/uploads/log-old-uuid");

    await request(appWithLogger)
      .patch(`/parties/${party.id}/ledger-entries/${entry.id}`)
      .send({ billImage: "/objects/uploads/log-new-uuid" })
      .expect(200);

    // The deletion is fire-and-forget (.catch()), so it may not have run yet
    // when the response arrives.  Drain the microtask / I/O queue once to let
    // the rejected Promise's .catch() callback execute.
    await new Promise<void>((resolve) => setImmediate(resolve));

    expect(logError).toHaveBeenCalledOnce();
    expect(logError.mock.calls[0][0]).toMatchObject({
      objectPath: "/objects/uploads/log-old-uuid",
    });

    vi.restoreAllMocks();
  });

  it("does NOT call deleteObjectEntity when billImage is absent from the request body", async () => {
    const { ObjectStorageService } = await import("../lib/objectStorage");
    const deleteSpy = vi
      .spyOn(ObjectStorageService.prototype, "deleteObjectEntity")
      .mockResolvedValue(undefined);

    const party = await createParty("No Billimage Body Party");
    const entry = await createEntry(party.id, "/objects/uploads/untouched-uuid");

    const app = makeApp(businessId);
    // Only update description — billImage not in body.
    await request(app)
      .patch(`/parties/${party.id}/ledger-entries/${entry.id}`)
      .send({ description: "updated description" })
      .expect(200);

    expect(deleteSpy).not.toHaveBeenCalled();

    // billImage must be unchanged in the DB.
    const updated = await fetchEntry(entry.id);
    expect(updated?.billImage).toBe("/objects/uploads/untouched-uuid");

    vi.restoreAllMocks();
  });

  it("does NOT call deleteObjectEntity when billImage is set to the same value", async () => {
    const { ObjectStorageService } = await import("../lib/objectStorage");
    const deleteSpy = vi
      .spyOn(ObjectStorageService.prototype, "deleteObjectEntity")
      .mockResolvedValue(undefined);

    const party = await createParty("Same Value Party");
    const entry = await createEntry(party.id, "/objects/uploads/same-uuid");

    const app = makeApp(businessId);
    await request(app)
      .patch(`/parties/${party.id}/ledger-entries/${entry.id}`)
      .send({ billImage: "/objects/uploads/same-uuid" })
      .expect(200);

    // No deletion — the value didn't change.
    expect(deleteSpy).not.toHaveBeenCalled();

    vi.restoreAllMocks();
  });

  it("does NOT call deleteObjectEntity when the entry had no previous photo", async () => {
    const { ObjectStorageService } = await import("../lib/objectStorage");
    const deleteSpy = vi
      .spyOn(ObjectStorageService.prototype, "deleteObjectEntity")
      .mockResolvedValue(undefined);

    const party = await createParty("No Previous Photo Party");
    // Entry starts with no billImage.
    const entry = await createEntry(party.id, null);

    const app = makeApp(businessId);
    await request(app)
      .patch(`/parties/${party.id}/ledger-entries/${entry.id}`)
      .send({ billImage: "/objects/uploads/brand-new-uuid" })
      .expect(200);

    // Nothing to delete — there was no old path.
    expect(deleteSpy).not.toHaveBeenCalled();

    // DB must hold the new path.
    const updated = await fetchEntry(entry.id);
    expect(updated?.billImage).toBe("/objects/uploads/brand-new-uuid");

    vi.restoreAllMocks();
  });
});

describe("PATCH ledger-entry — adjustment transitions", () => {
  it("converts a regular entry to a linked adjustment and updates both balances", async () => {
    const source = await createParty("Convert source", "150.00");
    const target = await createParty("Convert target", "100.00");
    const entry = await createEntry(source.id);

    const response = await request(makeApp(businessId))
      .patch(`/parties/${source.id}/ledger-entries/${entry.id}`)
      .send({
        amount: 80,
        type: "YOU_GAVE",
        description: "converted adjustment",
        isTransfer: true,
        transferPartyId: target.id,
      })
      .expect(200);

    const saved = await fetchEntry(entry.id);
    const counter = saved?.linkedEntryId ? await fetchEntry(saved.linkedEntryId) : null;
    expect(response.body).toMatchObject({
      isTransfer: true,
      transferPartyId: target.id,
      linkedEntryId: saved?.linkedEntryId,
    });
    expect(counter).toMatchObject({
      partyId: target.id,
      type: "YOU_GOT",
      amount: "80.00",
      description: "converted adjustment — অ্যাডজাস্ট করা হয়েছে Convert source-এর সাথে",
      transferPartyId: source.id,
      linkedEntryId: entry.id,
    });
    expect(signedBalance((await fetchParty(source.id))!)).toBe(180);
    expect(signedBalance((await fetchParty(target.id))!)).toBe(20);
  });

  it("retargets the linked row and reverses the old and new party balances atomically", async () => {
    const source = await createParty("Retarget source", "150.00");
    const oldTarget = await createParty("Retarget old", "50.00");
    const newTarget = await createParty("Retarget new", "100.00");
    const { primary, counter } = await createTransferPair(source.id, oldTarget.id);

    await request(makeApp(businessId))
      .patch(`/parties/${source.id}/ledger-entries/${primary.id}`)
      .send({
        amount: 80,
        type: "YOU_GAVE",
        isTransfer: true,
        transferPartyId: newTarget.id,
      })
      .expect(200);

    const saved = await fetchEntry(primary.id);
    const movedCounter = await fetchEntry(counter.id);
    expect(saved).toMatchObject({ isTransfer: true, transferPartyId: newTarget.id, linkedEntryId: counter.id });
    expect(movedCounter).toMatchObject({
      partyId: newTarget.id,
      amount: "80.00",
      type: "YOU_GOT",
      description: "adjusted with target — অ্যাডজাস্ট করা হয়েছে Retarget source-এর সাথে",
      transferPartyId: source.id,
      linkedEntryId: primary.id,
    });
    expect(signedBalance((await fetchParty(source.id))!)).toBe(180);
    expect(signedBalance((await fetchParty(oldTarget.id))!)).toBe(100);
    expect(signedBalance((await fetchParty(newTarget.id))!)).toBe(20);
  });

  it("removes the paired row when an adjustment is disabled and restores both balances", async () => {
    const source = await createParty("Unlink source", "150.00");
    const target = await createParty("Unlink target", "50.00");
    const { primary, counter } = await createTransferPair(source.id, target.id);

    await request(makeApp(businessId))
      .patch(`/parties/${source.id}/ledger-entries/${primary.id}`)
      .send({
        amount: 60,
        type: "YOU_GAVE",
        isTransfer: false,
        transferPartyId: null,
      })
      .expect(200);

    expect(await fetchEntry(primary.id)).toMatchObject({
      isTransfer: false,
      transferPartyId: null,
      linkedEntryId: null,
      amount: "60.00",
    });
    expect(await fetchEntry(counter.id)).toBeNull();
    expect(signedBalance((await fetchParty(source.id))!)).toBe(160);
    expect(signedBalance((await fetchParty(target.id))!)).toBe(100);
  });

  it("rejects linking to a different party role without changing either ledger", async () => {
    const source = await createParty("Role source", "150.00");
    const supplier = await createParty("Role supplier", "100.00", "SUPPLIER");
    const entry = await createEntry(source.id);

    await request(makeApp(businessId))
      .patch(`/parties/${source.id}/ledger-entries/${entry.id}`)
      .send({
        isTransfer: true,
        transferPartyId: supplier.id,
      })
      .expect(400);

    expect(await fetchEntry(entry.id)).toMatchObject({ isTransfer: false, transferPartyId: null });
    expect(signedBalance((await fetchParty(source.id))!)).toBe(150);
    expect(signedBalance((await fetchParty(supplier.id))!)).toBe(100);
  });
});
