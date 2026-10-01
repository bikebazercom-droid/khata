/**
 * Integration tests for DELETE /parties/:partyId/entries/:entryId
 *
 * These tests run against a real Postgres schema (DATABASE_URL).  Each suite
 * uses a freshly-created business UUID so rows are fully isolated and can be
 * cleaned up atomically at the end of the run.
 *
 * Covered scenarios
 * ─────────────────
 * 1. Normal entry  — entry deleted, balance reversed, other parties untouched
 * 2. Transfer happy path — both entries deleted, both balances reversed
 * 3. Transfer with missing linked entry — primary still deletes cleanly
 * 4. Atomicity — a mid-transaction failure leaves both entries and balances
 *    intact (verified by forcing a constraint violation)
 */

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { randomUUID } from "node:crypto";
import express, { type Request, type Response, type NextFunction } from "express";
import request from "supertest";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "@workspace/db";
import {
  partiesTable,
  ledgerEntriesTable,
  ledgerRequestReceiptsTable,
  businessesTable,
} from "@workspace/db";
import { eq, and } from "drizzle-orm";
import partiesRouter from "./parties";
import type { AuthenticatedRequest } from "../middlewares/requireAuth";

// ─── Helpers ─────────────────────────────────────────────────────────────────

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL must be set to run integration tests");
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const testDb = drizzle(pool, { schema });

/**
 * Converts the unsigned balance pair stored on a party row to a signed number
 * (positive = you will get, negative = you will give) — mirrors the helper in
 * lib/khatabook.ts.
 */
function toSigned(party: { currentBalance: string; balanceType: string }): number {
  const mag = Number(party.currentBalance);
  return party.balanceType === "YOU_WILL_GIVE" ? -mag : mag;
}

async function fetchParty(id: string) {
  const [row] = await testDb
    .select()
    .from(partiesTable)
    .where(eq(partiesTable.id, id));
  return row ?? null;
}

async function fetchEntry(id: string) {
  const [row] = await testDb
    .select()
    .from(ledgerEntriesTable)
    .where(eq(ledgerEntriesTable.id, id));
  return row ?? null;
}

// ─── Test app factory ────────────────────────────────────────────────────────

/**
 * Builds a minimal Express app that mounts the parties router.
 * The real Clerk / phone-JWT requireAuth middleware is replaced with a stub
 * that simply injects the provided businessId, which keeps tests isolated from
 * authentication infrastructure.
 */
function makeApp(businessId: string) {
  const app = express();
  app.use(express.json());

  // Fake auth: inject businessId without touching Clerk or JWT.
  app.use((req: Request, _res: Response, next: NextFunction) => {
    (req as unknown as AuthenticatedRequest).businessId = businessId;
    (req as unknown as AuthenticatedRequest).userId = "test-user";
    (req as unknown as AuthenticatedRequest).role = "owner";
    next();
  });

  app.use(partiesRouter);
  app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    console.error("Parties integration-test request failed:", error);
    res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
  });
  return app;
}

// ─── Test data setup ─────────────────────────────────────────────────────────

let businessId: string;

beforeAll(async () => {
  // Create an isolated business for this entire test run.
  const [biz] = await testDb
    .insert(businessesTable)
    .values({ name: "Test Business" })
    .returning();
  businessId = biz!.id;
});

afterAll(async () => {
  // Delete all parties for the test business (cascades to ledger_entries).
  await testDb
    .delete(partiesTable)
    .where(eq(partiesTable.businessId, businessId));

  await testDb
    .delete(businessesTable)
    .where(eq(businessesTable.id, businessId));

  await pool.end();
});

// ─── Suite helpers ────────────────────────────────────────────────────────────

async function createParty(opts: {
  name: string;
  signedBalance?: number;
  role?: "CUSTOMER" | "SUPPLIER";
}) {
  const signed = opts.signedBalance ?? 0;
  const balanceType = signed < 0 ? "YOU_WILL_GIVE" : "YOU_WILL_GET";
  const currentBalance = Math.abs(signed).toFixed(2);

  const [party] = await testDb
    .insert(partiesTable)
    .values({
      businessId,
      name: opts.name,
      phone: "",
      role: opts.role ?? "CUSTOMER",
      currentBalance,
      balanceType,
    })
    .returning();
  return party!;
}

async function createEntry(opts: {
  partyId: string;
  type: "YOU_GAVE" | "YOU_GOT";
  amount: number;
  isTransfer?: boolean;
  transferPartyId?: string;
  linkedEntryId?: string;
}) {
  const [entry] = await testDb
    .insert(ledgerEntriesTable)
    .values({
      partyId: opts.partyId,
      type: opts.type,
      amount: opts.amount.toFixed(2),
      description: "test entry",
      isTransfer: opts.isTransfer ?? false,
      transferPartyId: opts.transferPartyId ?? null,
      linkedEntryId: opts.linkedEntryId ?? null,
    })
    .returning();
  return entry!;
}

async function crossLink(entryAId: string, entryBId: string) {
  await testDb
    .update(ledgerEntriesTable)
    .set({ linkedEntryId: entryBId })
    .where(eq(ledgerEntriesTable.id, entryAId));
  await testDb
    .update(ledgerEntriesTable)
    .set({ linkedEntryId: entryAId })
    .where(eq(ledgerEntriesTable.id, entryBId));
}

// ─── Test 1: Normal (non-transfer) entry deletion ────────────────────────────

describe("DELETE /parties/:partyId/entries/:entryId — normal entry", () => {
  it("deletes the entry and reverses the balance, leaving other parties untouched", async () => {
    const app = makeApp(businessId);

    // Party A: owes us ৳200 (YOU_WILL_GET +200).
    const partyA = await createParty({ name: "Party A Normal", signedBalance: 200 });
    const entryA = await createEntry({ partyId: partyA.id, type: "YOU_GAVE", amount: 200 });

    // Bystander party — should not be affected.
    const bystander = await createParty({ name: "Bystander Normal", signedBalance: 500 });

    const res = await request(app)
      .delete(`/parties/${partyA.id}/entries/${entryA.id}`)
      .expect(200);

    expect(res.body).toEqual({ success: true });

    // Entry must be gone.
    expect(await fetchEntry(entryA.id)).toBeNull();

    // Balance must be reversed: removing a YOU_GAVE of 200 from +200 → 0.
    const updatedA = await fetchParty(partyA.id);
    expect(toSigned(updatedA!)).toBeCloseTo(0, 2);

    // Bystander balance must be untouched.
    const updatedBystander = await fetchParty(bystander.id);
    expect(toSigned(updatedBystander!)).toBeCloseTo(500, 2);
  });
});

describe("DELETE /parties/:partyId — permanent party deletion", () => {
  it("hard-deletes a supplier and its transfer counterpart, then recalculates the surviving balance", async () => {
    const app = makeApp(businessId);
    const supplier = await createParty({ name: "Supplier to delete", signedBalance: 320, role: "SUPPLIER" });
    const customer = await createParty({ name: "Transfer customer", signedBalance: -320 });
    const bystander = await createParty({ name: "Unrelated party", signedBalance: 130 });

    const supplierEntry = await createEntry({
      partyId: supplier.id,
      type: "YOU_GAVE",
      amount: 320,
      isTransfer: true,
      transferPartyId: customer.id,
    });
    const customerEntry = await createEntry({
      partyId: customer.id,
      type: "YOU_GOT",
      amount: 320,
      isTransfer: true,
      transferPartyId: supplier.id,
    });
    await crossLink(supplierEntry.id, customerEntry.id);

    const supplierRequestId = randomUUID();
    const customerRequestId = randomUUID();
    await testDb.insert(ledgerRequestReceiptsTable).values([
      {
        businessId,
        actorId: "test-user",
        clientRequestId: supplierRequestId,
        fingerprint: "supplier-entry",
        sourceEntry: supplierEntry,
      },
      {
        businessId,
        actorId: "test-user",
        clientRequestId: customerRequestId,
        fingerprint: "customer-entry",
        sourceEntry: customerEntry,
      },
    ]);

    const response = await request(app).delete(`/parties/${supplier.id}`).expect(200);
    expect(response.body).toEqual({ success: true, id: supplier.id });
    expect(await fetchParty(supplier.id)).toBeNull();
    expect(await fetchEntry(supplierEntry.id)).toBeNull();
    expect(await fetchEntry(customerEntry.id)).toBeNull();
    expect(toSigned((await fetchParty(customer.id))!)).toBeCloseTo(0, 2);
    expect(toSigned((await fetchParty(bystander.id))!)).toBeCloseTo(130, 2);

    const receipts = await testDb.select().from(ledgerRequestReceiptsTable)
      .where(and(
        eq(ledgerRequestReceiptsTable.businessId, businessId),
        eq(ledgerRequestReceiptsTable.actorId, "test-user"),
      ));
    const deletedReceipts = receipts.filter((receipt) =>
      receipt.clientRequestId === supplierRequestId || receipt.clientRequestId === customerRequestId,
    );
    expect(deletedReceipts).toHaveLength(2);
    expect(deletedReceipts.every((receipt) =>
      (receipt.sourceEntry as { __deletedEntry?: boolean }).__deletedEntry === true,
    )).toBe(true);
  });

  it("redacts deleted transaction details and rejects a delayed offline retry", async () => {
    const app = makeApp(businessId);
    const party = await createParty({ name: "Retry guard party" });
    const payload = {
      clientRequestId: randomUUID(),
      type: "YOU_GAVE",
      amount: 38.5,
      description: "private transaction detail",
    };

    const created = await request(app)
      .post(`/parties/${party.id}/ledger-entries`)
      .send(payload)
      .expect(201);

    await request(app)
      .delete(`/parties/${party.id}/entries/${created.body.id}`)
      .expect(200);

    const [receipt] = await testDb.select().from(ledgerRequestReceiptsTable).where(and(
      eq(ledgerRequestReceiptsTable.businessId, businessId),
      eq(ledgerRequestReceiptsTable.actorId, "test-user"),
      eq(ledgerRequestReceiptsTable.clientRequestId, payload.clientRequestId),
    ));
    expect(receipt?.sourceEntry).toEqual({ __deletedEntry: true });

    await request(app)
      .post(`/parties/${party.id}/ledger-entries`)
      .send(payload)
      .expect(409);

    expect(await fetchEntry(created.body.id)).toBeNull();
    expect(toSigned((await fetchParty(party.id))!)).toBeCloseTo(0, 2);
  });
});

// ─── Test 2: Transfer happy path ─────────────────────────────────────────────

describe("DELETE /parties/:partyId/entries/:entryId — transfer happy path", () => {
  it("deletes both entries and reverses both parties' balances atomically", async () => {
    const app = makeApp(businessId);

    /**
     * Scenario:
     *   Party A (YOU_GAVE ৳300)  ←→  Party B (YOU_GOT ৳300)
     *   Balances before:  A = +300 (YOU_WILL_GET),  B = -300 (YOU_WILL_GIVE)
     *   After deleting: both should return to 0.
     */
    const partyA = await createParty({ name: "Transfer A Happy", signedBalance: 300 });
    const partyB = await createParty({ name: "Transfer B Happy", signedBalance: -300 });

    const entryA = await createEntry({
      partyId: partyA.id,
      type: "YOU_GAVE",
      amount: 300,
      isTransfer: true,
      transferPartyId: partyB.id,
    });
    const entryB = await createEntry({
      partyId: partyB.id,
      type: "YOU_GOT",
      amount: 300,
      isTransfer: true,
      transferPartyId: partyA.id,
    });
    await crossLink(entryA.id, entryB.id);

    const res = await request(app)
      .delete(`/parties/${partyA.id}/entries/${entryA.id}`)
      .expect(200);

    expect(res.body).toEqual({ success: true });

    // Both entries must be gone.
    expect(await fetchEntry(entryA.id)).toBeNull();
    expect(await fetchEntry(entryB.id)).toBeNull();

    // Party A balance: was +300, YOU_GAVE 300 reversed → 0.
    const updatedA = await fetchParty(partyA.id);
    expect(toSigned(updatedA!)).toBeCloseTo(0, 2);

    // Party B balance: was -300, YOU_GOT 300 reversed → 0.
    const updatedB = await fetchParty(partyB.id);
    expect(toSigned(updatedB!)).toBeCloseTo(0, 2);
  });
});

// ─── Test 3: Transfer with missing linked (already-deleted counter) ───────────

describe("DELETE /parties/:partyId/entries/:entryId — transfer with missing counter", () => {
  it("deletes the primary entry and reverses its balance even when the linked entry is gone", async () => {
    const app = makeApp(businessId);

    /**
     * Scenario: the counter entry was already deleted (e.g. by a previous
     * partial delete).  The linkedEntryId is stale (NULL because the DB sets
     * it to NULL on cascade delete when the counter row was deleted).
     *
     * We simulate this by:
     *   1. Creating a transfer pair with cross-links.
     *   2. Deleting the counter entry directly from the DB (which via
     *      onDelete: "set null" nulls out the linkedEntryId on the primary).
     *   3. Then calling the DELETE endpoint for the primary entry.
     */
    const partyA = await createParty({ name: "Transfer A Miss", signedBalance: 150 });
    const partyB = await createParty({ name: "Transfer B Miss", signedBalance: -150 });

    const entryA = await createEntry({
      partyId: partyA.id,
      type: "YOU_GAVE",
      amount: 150,
      isTransfer: true,
      transferPartyId: partyB.id,
    });
    const entryB = await createEntry({
      partyId: partyB.id,
      type: "YOU_GOT",
      amount: 150,
      isTransfer: true,
      transferPartyId: partyA.id,
    });
    await crossLink(entryA.id, entryB.id);

    // Simulate: counter entry already gone (DB sets linkedEntryId = NULL via
    // onDelete: "set null").
    await testDb
      .delete(ledgerEntriesTable)
      .where(eq(ledgerEntriesTable.id, entryB.id));

    // At this point entryA.linkedEntryId has been set to NULL by the DB cascade.
    const liveEntryA = await fetchEntry(entryA.id);
    expect(liveEntryA!.linkedEntryId).toBeNull();

    const res = await request(app)
      .delete(`/parties/${partyA.id}/entries/${entryA.id}`)
      .expect(200);

    expect(res.body).toEqual({ success: true });

    // Primary entry must be gone.
    expect(await fetchEntry(entryA.id)).toBeNull();

    // Primary party's balance must still be reversed.
    const updatedA = await fetchParty(partyA.id);
    expect(toSigned(updatedA!)).toBeCloseTo(0, 2);

    // Party B balance must be untouched (no linked entry existed to act on).
    const updatedB = await fetchParty(partyB.id);
    expect(toSigned(updatedB!)).toBeCloseTo(-150, 2);
  });
});

// ─── Test 5: Cross-business transfer — counter entry must NOT be touched ──────

describe("DELETE /parties/:partyId/entries/:entryId — cross-business transfer", () => {
  let otherBusinessId: string;

  beforeAll(async () => {
    const [biz] = await testDb
      .insert(businessesTable)
      .values({ name: "Other Business Cross-Biz" })
      .returning();
    otherBusinessId = biz!.id;
  });

  afterAll(async () => {
    // Cascade-delete parties (and thus entries) for the other business.
    await testDb
      .delete(partiesTable)
      .where(eq(partiesTable.businessId, otherBusinessId));
    await testDb
      .delete(businessesTable)
      .where(eq(businessesTable.id, otherBusinessId));
  });

  it(
    "deletes the primary entry and reverses its balance, " +
    "but leaves the counter entry and its party balance untouched",
    async () => {
      // The request is authenticated as businessId (Business A).
      const app = makeApp(businessId);

      // Party A belongs to Business A (the authenticated business).
      const partyA = await createParty({ name: "Cross-Biz A", signedBalance: 500 });

      // Party B belongs to Business B (a completely different business).
      const [partyB] = await testDb
        .insert(partiesTable)
        .values({
          businessId: otherBusinessId,
          name: "Cross-Biz B",
          phone: "",
          role: "CUSTOMER",
          currentBalance: "500.00",
          balanceType: "YOU_WILL_GIVE",
        })
        .returning();

      // Primary entry on Party A.
      const entryA = await createEntry({
        partyId: partyA.id,
        type: "YOU_GAVE",
        amount: 500,
        isTransfer: true,
        transferPartyId: partyB!.id,
      });

      // Counter entry on Party B (different business).
      const [entryB] = await testDb
        .insert(ledgerEntriesTable)
        .values({
          partyId: partyB!.id,
          type: "YOU_GOT",
          amount: "500.00",
          description: "cross-biz counter",
          isTransfer: true,
          transferPartyId: partyA.id,
        })
        .returning();

      await crossLink(entryA.id, entryB!.id);

      // Delete the primary entry as Business A.
      const res = await request(app)
        .delete(`/parties/${partyA.id}/entries/${entryA.id}`)
        .expect(200);

      expect(res.body).toEqual({ success: true });

      // Primary entry must be gone.
      expect(await fetchEntry(entryA.id)).toBeNull();

      // Primary party balance must be reversed: was +500, YOU_GAVE 500 → 0.
      const updatedA = await fetchParty(partyA.id);
      expect(toSigned(updatedA!)).toBeCloseTo(0, 2);

      // Counter entry on Business B must still exist — no cross-business deletion.
      expect(await fetchEntry(entryB!.id)).not.toBeNull();

      // Party B balance must be untouched — Business A cannot modify Business B.
      const updatedB = await fetchParty(partyB!.id);
      expect(toSigned(updatedB!)).toBeCloseTo(-500, 2);
    },
  );

  it("never updates party rows belonging to a different business", async () => {
    const app = makeApp(businessId);

    const partyA2 = await createParty({ name: "Cross-Biz A2", signedBalance: 250 });
    const [partyB2] = await testDb
      .insert(partiesTable)
      .values({
        businessId: otherBusinessId,
        name: "Cross-Biz B2",
        phone: "",
        role: "CUSTOMER",
        currentBalance: "250.00",
        balanceType: "YOU_WILL_GIVE",
      })
      .returning();

    const entryA2 = await createEntry({
      partyId: partyA2.id,
      type: "YOU_GAVE",
      amount: 250,
      isTransfer: true,
      transferPartyId: partyB2!.id,
    });
    const [entryB2] = await testDb
      .insert(ledgerEntriesTable)
      .values({
        partyId: partyB2!.id,
        type: "YOU_GOT",
        amount: "250.00",
        description: "cross-biz counter 2",
        isTransfer: true,
        transferPartyId: partyA2.id,
      })
      .returning();
    await crossLink(entryA2.id, entryB2!.id);

    // Record Party B2's balance before the delete.
    const partyB2Before = await fetchParty(partyB2!.id);
    const balanceBefore = toSigned(partyB2Before!);

    await request(app)
      .delete(`/parties/${partyA2.id}/entries/${entryA2.id}`)
      .expect(200);

    // Party B2 balance must not have changed at all.
    const partyB2After = await fetchParty(partyB2!.id);
    expect(toSigned(partyB2After!)).toBeCloseTo(balanceBefore, 2);
  });
});

// ─── Test 4a: Normal-entry atomicity — mid-transaction failure leaves entry and balance intact ──

describe("DELETE /parties/:partyId/entries/:entryId — normal entry atomicity on failure", () => {
  it("leaves both the entry and the balance unchanged when the transaction is rolled back", async () => {
    /**
     * Strategy: spy on db.transaction and force a rollback by throwing after
     * the real Postgres transaction runs.  The entry and balance must both be
     * unchanged — proving that the normal-entry delete path is transactional.
     */
    const dbModule = await import("@workspace/db");
    const db = dbModule.db;

    // Party with a known balance.
    const party = await createParty({ name: "Normal Atomic", signedBalance: 350 });
    const entry = await createEntry({ partyId: party.id, type: "YOU_GAVE", amount: 350 });

    const originalTransaction = db.transaction.bind(db);
    let callCount = 0;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const forcedRollbackImpl: any = async (callback: (tx: unknown) => Promise<void>) => {
      callCount++;
      try {
        await originalTransaction(async (tx) => {
          await callback(tx);
          throw new Error("__FORCED_ROLLBACK__");
        });
      } catch (err: unknown) {
        if (err instanceof Error && err.message !== "__FORCED_ROLLBACK__") {
          throw err;
        }
        // swallow — Postgres transaction is already rolled back
      }
    };
    vi.spyOn(db, "transaction").mockImplementationOnce(forcedRollbackImpl);

    const app = makeApp(businessId);

    await request(app)
      .delete(`/parties/${party.id}/entries/${entry.id}`)
      .expect(200);

    expect(callCount).toBe(1);

    // Entry must still exist (transaction was rolled back).
    expect(await fetchEntry(entry.id)).not.toBeNull();

    // Balance must be unchanged at +350.
    const updated = await fetchParty(party.id);
    expect(toSigned(updated!)).toBeCloseTo(350, 2);

    vi.restoreAllMocks();
  });
});

// ─── Test 5a: DELETE /parties/:partyId/entries/:entryId — bill photo cleanup ──

describe("DELETE /parties/:partyId/entries/:entryId — bill photo cleanup", () => {
  it("calls deleteObjectEntity for the /objects/ path attached to a normal entry", async () => {
    const { ObjectStorageService } = await import("../lib/objectStorage");
    const deleteSpy = vi
      .spyOn(ObjectStorageService.prototype, "deleteObjectEntity")
      .mockResolvedValue(undefined);

    const app = makeApp(businessId);

    const party = await createParty({ name: "Single Entry Photo Party", signedBalance: 100 });

    // Insert entry directly so we can attach a billImage path.
    const [entry] = await testDb
      .insert(ledgerEntriesTable)
      .values({
        partyId: party.id,
        type: "YOU_GAVE",
        amount: "100.00",
        description: "entry with photo",
        billImage: "/objects/uploads/uuid-single-111",
      })
      .returning();

    const res = await request(app)
      .delete(`/parties/${party.id}/entries/${entry!.id}`)
      .expect(200);

    expect(res.body).toEqual({ success: true });

    // Entry must be gone.
    expect(await fetchEntry(entry!.id)).toBeNull();

    // Storage must have been asked to delete the bill photo.
    expect(deleteSpy).toHaveBeenCalledWith("/objects/uploads/uuid-single-111");

    vi.restoreAllMocks();
  });

  it("still returns 200 and deletes the DB entry even when storage deletion fails", async () => {
    const { ObjectStorageService } = await import("../lib/objectStorage");
    vi.spyOn(ObjectStorageService.prototype, "deleteObjectEntity").mockRejectedValue(
      new Error("storage unavailable"),
    );

    const app = makeApp(businessId);

    const party = await createParty({ name: "Single Entry Storage Fail", signedBalance: 200 });

    const [entry] = await testDb
      .insert(ledgerEntriesTable)
      .values({
        partyId: party.id,
        type: "YOU_GAVE",
        amount: "200.00",
        description: "entry with photo",
        billImage: "/objects/uploads/uuid-single-222",
      })
      .returning();

    // Storage failure must not bubble up as an HTTP error.
    const res = await request(app)
      .delete(`/parties/${party.id}/entries/${entry!.id}`)
      .expect(200);

    expect(res.body).toEqual({ success: true });

    // DB entry must be gone despite the storage failure.
    expect(await fetchEntry(entry!.id)).toBeNull();

    vi.restoreAllMocks();
  });

  it("calls req.log.error with the objectPath when storage deletion fails for a normal entry", async () => {
    const { ObjectStorageService } = await import("../lib/objectStorage");
    vi.spyOn(ObjectStorageService.prototype, "deleteObjectEntity").mockRejectedValue(
      new Error("storage unavailable"),
    );

    const logError = vi.fn();

    // Build an app that attaches a mock logger to req so we can assert that
    // the fire-and-forget .catch() actually invokes req.log.error.
    const appWithLogger = express();
    appWithLogger.use(express.json());
    appWithLogger.use((req: Request, _res: Response, next: NextFunction) => {
      (req as unknown as AuthenticatedRequest).businessId = businessId;
      (req as unknown as AuthenticatedRequest).userId = "test-user";
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (req as any).log = { error: logError };
      next();
    });
    appWithLogger.use(partiesRouter);

    const party = await createParty({ name: "Log Error Normal Delete Party", signedBalance: 300 });

    const [entry] = await testDb
      .insert(ledgerEntriesTable)
      .values({
        partyId: party.id,
        type: "YOU_GAVE",
        amount: "300.00",
        description: "entry with photo for log test",
        billImage: "/objects/uploads/uuid-log-normal-delete",
      })
      .returning();

    await request(appWithLogger)
      .delete(`/parties/${party.id}/entries/${entry!.id}`)
      .expect(200);

    // The deletion uses fire-and-forget (.catch()), so the callback may not
    // have run yet when the HTTP response arrives.  Drain the microtask / I/O
    // queue to allow the rejected Promise's .catch() to execute.
    await new Promise<void>((resolve) => setImmediate(resolve));

    expect(logError).toHaveBeenCalledOnce();
    expect(logError.mock.calls[0][0]).toMatchObject({
      objectPath: "/objects/uploads/uuid-log-normal-delete",
    });

    vi.restoreAllMocks();
  });

  it("does NOT call deleteObjectEntity when the entry has no bill photo", async () => {
    const { ObjectStorageService } = await import("../lib/objectStorage");
    const deleteSpy = vi
      .spyOn(ObjectStorageService.prototype, "deleteObjectEntity")
      .mockResolvedValue(undefined);

    const app = makeApp(businessId);

    const party = await createParty({ name: "Single Entry No Photo", signedBalance: 50 });
    const entry = await createEntry({ partyId: party.id, type: "YOU_GAVE", amount: 50 });

    await request(app)
      .delete(`/parties/${party.id}/entries/${entry.id}`)
      .expect(200);

    expect(deleteSpy).not.toHaveBeenCalled();

    vi.restoreAllMocks();
  });
});

// ─── Test 5b: DELETE /parties/:partyId/entries/:entryId — transfer bill photo cleanup ──

describe("DELETE /parties/:partyId/entries/:entryId — transfer bill photo cleanup", () => {
  it("calls deleteObjectEntity for both the primary and counter-entry bill photos", async () => {
    const { ObjectStorageService } = await import("../lib/objectStorage");
    const deleteSpy = vi
      .spyOn(ObjectStorageService.prototype, "deleteObjectEntity")
      .mockResolvedValue(undefined);

    const app = makeApp(businessId);

    const partyA = await createParty({ name: "Transfer Photo A", signedBalance: 250 });
    const partyB = await createParty({ name: "Transfer Photo B", signedBalance: -250 });

    // Insert both entries directly so we can attach billImage paths.
    const [entryA] = await testDb
      .insert(ledgerEntriesTable)
      .values({
        partyId: partyA.id,
        type: "YOU_GAVE",
        amount: "250.00",
        description: "transfer with photo A",
        isTransfer: true,
        transferPartyId: partyB.id,
        billImage: "/objects/uploads/uuid-transfer-primary",
      })
      .returning();

    const [entryB] = await testDb
      .insert(ledgerEntriesTable)
      .values({
        partyId: partyB.id,
        type: "YOU_GOT",
        amount: "250.00",
        description: "transfer with photo B",
        isTransfer: true,
        transferPartyId: partyA.id,
        billImage: "/objects/uploads/uuid-transfer-counter",
      })
      .returning();

    await crossLink(entryA!.id, entryB!.id);

    const res = await request(app)
      .delete(`/parties/${partyA.id}/entries/${entryA!.id}`)
      .expect(200);

    expect(res.body).toEqual({ success: true });

    // Both DB entries must be gone.
    expect(await fetchEntry(entryA!.id)).toBeNull();
    expect(await fetchEntry(entryB!.id)).toBeNull();

    // Storage must have been asked to delete both /objects/ paths.
    const deletedPaths = deleteSpy.mock.calls.map((c) => c[0]).sort();
    expect(deletedPaths).toEqual([
      "/objects/uploads/uuid-transfer-counter",
      "/objects/uploads/uuid-transfer-primary",
    ]);

    vi.restoreAllMocks();
  });

  it("still returns 200 when storage deletion fails for the counter-entry photo", async () => {
    const { ObjectStorageService } = await import("../lib/objectStorage");
    vi.spyOn(ObjectStorageService.prototype, "deleteObjectEntity").mockRejectedValue(
      new Error("storage unavailable"),
    );

    const app = makeApp(businessId);

    const partyA = await createParty({ name: "Transfer Photo Fail A", signedBalance: 100 });
    const partyB = await createParty({ name: "Transfer Photo Fail B", signedBalance: -100 });

    const [entryA] = await testDb
      .insert(ledgerEntriesTable)
      .values({
        partyId: partyA.id,
        type: "YOU_GAVE",
        amount: "100.00",
        description: "transfer photo fail A",
        isTransfer: true,
        transferPartyId: partyB.id,
        billImage: "/objects/uploads/uuid-transfer-fail-primary",
      })
      .returning();

    const [entryB] = await testDb
      .insert(ledgerEntriesTable)
      .values({
        partyId: partyB.id,
        type: "YOU_GOT",
        amount: "100.00",
        description: "transfer photo fail B",
        isTransfer: true,
        transferPartyId: partyA.id,
        billImage: "/objects/uploads/uuid-transfer-fail-counter",
      })
      .returning();

    await crossLink(entryA!.id, entryB!.id);

    // Storage failure must not bubble up as an HTTP error.
    const res = await request(app)
      .delete(`/parties/${partyA.id}/entries/${entryA!.id}`)
      .expect(200);

    expect(res.body).toEqual({ success: true });

    // Both DB entries must be gone despite the storage failure.
    expect(await fetchEntry(entryA!.id)).toBeNull();
    expect(await fetchEntry(entryB!.id)).toBeNull();

    vi.restoreAllMocks();
  });

  it("calls req.log.error with each objectPath when storage deletion fails for a transfer entry", async () => {
    const { ObjectStorageService } = await import("../lib/objectStorage");
    vi.spyOn(ObjectStorageService.prototype, "deleteObjectEntity").mockRejectedValue(
      new Error("storage unavailable"),
    );

    const logError = vi.fn();

    // Build an app with a mock logger attached to req.
    // The transfer DELETE path uses Promise.allSettled (awaited), so req.log.error
    // is called before the response is sent — no microtask drain needed.
    const appWithLogger = express();
    appWithLogger.use(express.json());
    appWithLogger.use((req: Request, _res: Response, next: NextFunction) => {
      (req as unknown as AuthenticatedRequest).businessId = businessId;
      (req as unknown as AuthenticatedRequest).userId = "test-user";
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (req as any).log = { error: logError };
      next();
    });
    appWithLogger.use(partiesRouter);

    const partyA = await createParty({ name: "Transfer Log Error A", signedBalance: 150 });
    const partyB = await createParty({ name: "Transfer Log Error B", signedBalance: -150 });

    const [entryA] = await testDb
      .insert(ledgerEntriesTable)
      .values({
        partyId: partyA.id,
        type: "YOU_GAVE",
        amount: "150.00",
        description: "transfer log error A",
        isTransfer: true,
        transferPartyId: partyB.id,
        billImage: "/objects/uploads/uuid-log-transfer-primary",
      })
      .returning();

    const [entryB] = await testDb
      .insert(ledgerEntriesTable)
      .values({
        partyId: partyB.id,
        type: "YOU_GOT",
        amount: "150.00",
        description: "transfer log error B",
        isTransfer: true,
        transferPartyId: partyA.id,
        billImage: "/objects/uploads/uuid-log-transfer-counter",
      })
      .returning();

    await crossLink(entryA!.id, entryB!.id);

    await request(appWithLogger)
      .delete(`/parties/${partyA.id}/entries/${entryA!.id}`)
      .expect(200);

    // Promise.allSettled is awaited before res.json(), so both error log calls
    // have already happened by the time the response arrives.
    expect(logError).toHaveBeenCalledTimes(2);
    const loggedPaths = logError.mock.calls.map((c) => (c[0] as { objectPath: string }).objectPath).sort();
    expect(loggedPaths).toEqual([
      "/objects/uploads/uuid-log-transfer-counter",
      "/objects/uploads/uuid-log-transfer-primary",
    ]);

    vi.restoreAllMocks();
  });
});

// ─── Test 5: DELETE /parties/:partyId — bill photo cleanup in object storage ──

describe("DELETE /parties/:partyId — bill photo cleanup", () => {
  it("calls deleteObjectEntity for every /objects/ path attached to the party's entries", async () => {
    const { ObjectStorageService } = await import("../lib/objectStorage");
    const deleteSpy = vi
      .spyOn(ObjectStorageService.prototype, "deleteObjectEntity")
      .mockResolvedValue(undefined);

    const app = makeApp(businessId);

    const party = await createParty({ name: "Photo Cleanup Party", signedBalance: 0 });

    // Insert entries directly with billImage paths so we bypass the API
    // schema restriction (isTransfer is a test-only field here).
    const [entry1] = await testDb
      .insert(ledgerEntriesTable)
      .values({
        partyId: party.id,
        type: "YOU_GAVE",
        amount: "100.00",
        description: "entry with photo 1",
        billImage: "/objects/uploads/uuid-aaa",
      })
      .returning();

    const [entry2] = await testDb
      .insert(ledgerEntriesTable)
      .values({
        partyId: party.id,
        type: "YOU_GOT",
        amount: "50.00",
        description: "entry with photo 2",
        billImage: "/objects/uploads/uuid-bbb",
      })
      .returning();

    // Entry without a bill image — should not trigger a storage call.
    const [entry3] = await testDb
      .insert(ledgerEntriesTable)
      .values({
        partyId: party.id,
        type: "YOU_GAVE",
        amount: "25.00",
        description: "entry without photo",
        billImage: null,
      })
      .returning();

    const res = await request(app)
      .delete(`/parties/${party.id}`)
      .expect(200);

    expect(res.body).toMatchObject({ success: true, id: party.id });

    // Party and all entries must be gone.
    expect(await fetchParty(party.id)).toBeNull();
    expect(await fetchEntry(entry1!.id)).toBeNull();
    expect(await fetchEntry(entry2!.id)).toBeNull();
    expect(await fetchEntry(entry3!.id)).toBeNull();

    // Storage must have been asked to delete exactly the two /objects/ paths.
    const deletedPaths = deleteSpy.mock.calls.map((c) => c[0]).sort();
    expect(deletedPaths).toEqual([
      "/objects/uploads/uuid-aaa",
      "/objects/uploads/uuid-bbb",
    ]);

    vi.restoreAllMocks();
  });

  it("still returns 200 and completes the DB delete even when storage deletion fails", async () => {
    const { ObjectStorageService } = await import("../lib/objectStorage");
    vi.spyOn(ObjectStorageService.prototype, "deleteObjectEntity").mockRejectedValue(
      new Error("storage unavailable"),
    );

    const app = makeApp(businessId);

    const party = await createParty({ name: "Storage Fail Party", signedBalance: 0 });
    await testDb.insert(ledgerEntriesTable).values({
      partyId: party.id,
      type: "YOU_GAVE",
      amount: "10.00",
      description: "entry with photo",
      billImage: "/objects/uploads/uuid-ccc",
    });

    // Storage failure must not bubble up as an HTTP error.
    const res = await request(app)
      .delete(`/parties/${party.id}`)
      .expect(200);

    expect(res.body).toMatchObject({ success: true, id: party.id });

    // DB row must be gone despite the storage failure.
    expect(await fetchParty(party.id)).toBeNull();

    vi.restoreAllMocks();
  });

  it("calls req.log.error once per rejected path when storage deletion fails for a party with multiple bill photos", async () => {
    const { ObjectStorageService } = await import("../lib/objectStorage");
    vi.spyOn(ObjectStorageService.prototype, "deleteObjectEntity").mockRejectedValue(
      new Error("storage unavailable"),
    );

    const logError = vi.fn();

    // Build an app that attaches a mock logger to req so we can assert that
    // req.log.error is invoked for every rejected storage deletion.
    // The party-delete handler awaits Promise.allSettled before calling
    // res.json(), so all req.log.error calls have already happened by the
    // time the HTTP response is received — no microtask drain is needed.
    const appWithLogger = express();
    appWithLogger.use(express.json());
    appWithLogger.use((req: Request, _res: Response, next: NextFunction) => {
      (req as unknown as AuthenticatedRequest).businessId = businessId;
      (req as unknown as AuthenticatedRequest).userId = "test-user";
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (req as any).log = { error: logError };
      next();
    });
    appWithLogger.use(partiesRouter);

    const party = await createParty({ name: "Multi Photo Log Error Party", signedBalance: 0 });

    // Insert two entries with distinct bill-image paths.
    await testDb.insert(ledgerEntriesTable).values({
      partyId: party.id,
      type: "YOU_GAVE",
      amount: "50.00",
      description: "photo entry 1",
      billImage: "/objects/uploads/uuid-bulk-log-aaa",
    });
    await testDb.insert(ledgerEntriesTable).values({
      partyId: party.id,
      type: "YOU_GOT",
      amount: "75.00",
      description: "photo entry 2",
      billImage: "/objects/uploads/uuid-bulk-log-bbb",
    });

    const res = await request(appWithLogger)
      .delete(`/parties/${party.id}`)
      .expect(200);

    expect(res.body).toMatchObject({ success: true, id: party.id });

    // req.log.error must have been called once per rejected path.
    expect(logError).toHaveBeenCalledTimes(2);

    const loggedPaths = logError.mock.calls
      .map((c) => (c[0] as { objectPath: string }).objectPath)
      .sort();
    expect(loggedPaths).toEqual([
      "/objects/uploads/uuid-bulk-log-aaa",
      "/objects/uploads/uuid-bulk-log-bbb",
    ]);

    vi.restoreAllMocks();
  });

  it("does NOT call deleteObjectEntity when the DB transaction throws", async () => {
    // When `db.transaction` propagates an error the handler must not proceed to
    // storage deletion — the entries still exist and their objects must stay intact.
    const { ObjectStorageService } = await import("../lib/objectStorage");
    const deleteSpy = vi
      .spyOn(ObjectStorageService.prototype, "deleteObjectEntity")
      .mockResolvedValue(undefined);

    const dbModule = await import("@workspace/db");
    const db = dbModule.db;

    const party = await createParty({ name: "Rollback Photo Party", signedBalance: 0 });
    await testDb.insert(ledgerEntriesTable).values({
      partyId: party.id,
      type: "YOU_GAVE",
      amount: "10.00",
      description: "entry with photo",
      billImage: "/objects/uploads/uuid-ddd",
    });

    // Make db.transaction throw so the handler surfaces a 500 error and never
    // reaches the post-commit storage cleanup block.
    const dbTransactionSpy = vi
      .spyOn(db, "transaction")
      .mockRejectedValueOnce(new Error("__DB_ERROR__"));

    const app = makeApp(businessId);
    // Handler must propagate the DB error as a 500.
    await request(app).delete(`/parties/${party.id}`).expect(500);

    expect(dbTransactionSpy).toHaveBeenCalledTimes(1);

    // Storage must NOT have been touched — the transaction never committed.
    expect(deleteSpy).not.toHaveBeenCalled();

    // Party row must still exist (transaction was never committed).
    expect(await fetchParty(party.id)).not.toBeNull();

    vi.restoreAllMocks();
  });
});

// ─── Test 6: DELETE /parties/:partyId — atomicity on mid-operation failure ────

describe("DELETE /parties/:partyId — atomicity on failure", () => {
  it("leaves both the party row and its ledger entries intact when the transaction is rolled back", async () => {
    /**
     * Strategy: spy on db.transaction and force a rollback by throwing after
     * the real Postgres transaction runs.  Both the party row and its entries
     * must remain unchanged — proving the party delete path is transactional.
     */
    const dbModule = await import("@workspace/db");
    const db = dbModule.db;

    // Create a party with two entries.
    const party = await createParty({ name: "Party Delete Atomic", signedBalance: 100 });
    const entry1 = await createEntry({ partyId: party.id, type: "YOU_GAVE", amount: 60 });
    const entry2 = await createEntry({ partyId: party.id, type: "YOU_GOT", amount: 40 });

    const originalTransaction = db.transaction.bind(db);
    let callCount = 0;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const forcedRollbackImpl: any = async (callback: (tx: unknown) => Promise<unknown>) => {
      callCount++;
      let callbackResult: unknown;
      try {
        await originalTransaction(async (tx) => {
          callbackResult = await callback(tx);
          throw new Error("__FORCED_ROLLBACK__");
        });
      } catch (err: unknown) {
        if (err instanceof Error && err.message !== "__FORCED_ROLLBACK__") {
          throw err;
        }
        // swallow — Postgres transaction is already rolled back
      }
      return callbackResult;
    };
    vi.spyOn(db, "transaction").mockImplementationOnce(forcedRollbackImpl);

    const app = makeApp(businessId);

    // The mock swallows the forced error so the handler still returns 200;
    // what matters is that Postgres rolled back.
    await request(app)
      .delete(`/parties/${party.id}`)
      .expect(200);

    expect(callCount).toBe(1);

    // Party row must still exist.
    expect(await fetchParty(party.id)).not.toBeNull();

    // Both ledger entries must still exist.
    expect(await fetchEntry(entry1.id)).not.toBeNull();
    expect(await fetchEntry(entry2.id)).not.toBeNull();

    vi.restoreAllMocks();
  });
});

// ─── Test 4: Atomicity — mid-transaction failure rolls everything back ────────

describe("DELETE /parties/:partyId/entries/:entryId — atomicity on failure", () => {
  it("rolls back both the balance update and the entry deletion when the transaction fails", async () => {
    /**
     * Strategy: spy on the db module's `transaction` method and replace its
     * callback with one that deliberately throws after updating party A's
     * balance but before deleting the entry.  Then assert that party A's
     * balance and entry A still exist unchanged.
     *
     * We use vi.doMock / vi.importMock patterns (ESM-compatible) to intercept
     * the shared db singleton.  Because `parties.ts` imports `db` from
     * `@workspace/db`, we spy directly on the exported `db` object's
     * `transaction` property.
     */

    // Import the live db to spy on it.
    const dbModule = await import("@workspace/db");
    const db = dbModule.db;

    const partyA = await createParty({ name: "Atomic A", signedBalance: 400 });
    const partyB = await createParty({ name: "Atomic B", signedBalance: -400 });

    const entryA = await createEntry({
      partyId: partyA.id,
      type: "YOU_GAVE",
      amount: 400,
      isTransfer: true,
      transferPartyId: partyB.id,
    });
    const entryB = await createEntry({
      partyId: partyB.id,
      type: "YOU_GOT",
      amount: 400,
      isTransfer: true,
      transferPartyId: partyA.id,
    });
    await crossLink(entryA.id, entryB.id);

    // Wrap db.transaction to execute the real transaction but then force a
    // rollback by throwing after the callback runs partway.
    // We achieve this by overriding the exported db.transaction to run the
    // actual Postgres transaction and then throw, causing Drizzle to roll back.
    const originalTransaction = db.transaction.bind(db);
    let callCount = 0;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const forcedRollbackImpl: any = async (callback: (tx: unknown) => Promise<void>) => {
      callCount++;
      // Wrap the handler's callback in a real Postgres transaction, then throw
      // so Drizzle rolls everything back — simulating a mid-transaction failure.
      try {
        await originalTransaction(async (tx) => {
          await callback(tx);
          throw new Error("__FORCED_ROLLBACK__");
        });
      } catch (err: unknown) {
        if (err instanceof Error && err.message !== "__FORCED_ROLLBACK__") {
          throw err; // re-throw unexpected errors
        }
        // swallow — the Postgres transaction is already rolled back
      }
    };
    vi.spyOn(db, "transaction").mockImplementationOnce(forcedRollbackImpl);

    const app = makeApp(businessId);

    // The mock swallows the forced rollback, so the handler sees a clean return
    // and responds 200.  What matters is that the Postgres transaction was
    // rolled back — verified by the DB assertions below.
    await request(app)
      .delete(`/parties/${partyA.id}/entries/${entryA.id}`)
      .expect(200);

    expect(callCount).toBe(1);

    // Entry A must still exist (transaction was rolled back).
    expect(await fetchEntry(entryA.id)).not.toBeNull();
    // Entry B must still exist.
    expect(await fetchEntry(entryB.id)).not.toBeNull();

    // Party A balance must be unchanged at +400.
    const updatedA = await fetchParty(partyA.id);
    expect(toSigned(updatedA!)).toBeCloseTo(400, 2);

    // Party B balance must be unchanged at -400.
    const updatedB = await fetchParty(partyB.id);
    expect(toSigned(updatedB!)).toBeCloseTo(-400, 2);

    vi.restoreAllMocks();
  });
});
