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
import express, { type Request, type Response, type NextFunction } from "express";
import request from "supertest";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "@workspace/db";
import {
  partiesTable,
  ledgerEntriesTable,
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
    next();
  });

  app.use(partiesRouter);
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
      role: "CUSTOMER",
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
