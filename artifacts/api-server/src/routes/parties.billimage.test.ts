/**
 * Unit tests for billImage /objects/ prefix validation
 *
 * Covered scenarios
 * ─────────────────
 * POST /parties/:partyId/ledger-entries
 *   1. billImage without /objects/ prefix → 400
 *   2. billImage as a bare filename → 400
 *   3. billImage as a full URL → 400
 *   4. billImage with correct /objects/ prefix → 201
 *   5. billImage absent → 201 (no billImage stored)
 *   6. billImage explicitly null → 201 (allowed)
 *
 * PATCH /parties/:partyId/ledger-entries/:entryId
 *   7. billImage without /objects/ prefix → 400
 *   8. billImage as a full URL → 400
 *   9. billImage with correct /objects/ prefix → 200
 *  10. billImage set to null → 200 (allowed — means "remove photo")
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
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
    next();
  });
  app.use(partiesRouter);
  return app;
}

let businessId: string;
let partyId: string;

beforeAll(async () => {
  const [biz] = await testDb
    .insert(businessesTable)
    .values({ name: "BillImage Validation Test Business" })
    .returning();
  businessId = biz!.id;

  const [party] = await testDb
    .insert(partiesTable)
    .values({
      businessId,
      name: "Test Party",
      phone: "",
      role: "CUSTOMER",
      currentBalance: "0.00",
      balanceType: "YOU_WILL_GET",
    })
    .returning();
  partyId = party!.id;
});

afterAll(async () => {
  await testDb.delete(ledgerEntriesTable).where(eq(ledgerEntriesTable.partyId, partyId));
  await testDb.delete(partiesTable).where(eq(partiesTable.businessId, businessId));
  await testDb.delete(businessesTable).where(eq(businessesTable.id, businessId));
  await pool.end();
});

// ─── POST tests ───────────────────────────────────────────────────────────────

describe("POST ledger-entry — billImage prefix validation", () => {
  it("rejects a billImage without the /objects/ prefix with 400", async () => {
    const app = makeApp(businessId);
    const res = await request(app)
      .post(`/parties/${partyId}/ledger-entries`)
      .send({
        type: "YOU_GAVE",
        amount: 100,
        description: "test",
        billImage: "uploads/some-image.jpg",
      })
      .expect(400);

    expect(res.body.error).toMatch(/billImage must start with \/objects\//);
  });

  it("rejects a bare filename as billImage with 400", async () => {
    const app = makeApp(businessId);
    const res = await request(app)
      .post(`/parties/${partyId}/ledger-entries`)
      .send({
        type: "YOU_GAVE",
        amount: 100,
        description: "test",
        billImage: "some-image.jpg",
      })
      .expect(400);

    expect(res.body.error).toMatch(/billImage must start with \/objects\//);
  });

  it("rejects a full URL as billImage with 400", async () => {
    const app = makeApp(businessId);
    const res = await request(app)
      .post(`/parties/${partyId}/ledger-entries`)
      .send({
        type: "YOU_GAVE",
        amount: 100,
        description: "test",
        billImage: "https://cdn.example.com/uploads/some-image.jpg",
      })
      .expect(400);

    expect(res.body.error).toMatch(/billImage must start with \/objects\//);
  });

  it("accepts a billImage with the correct /objects/ prefix", async () => {
    const app = makeApp(businessId);
    const res = await request(app)
      .post(`/parties/${partyId}/ledger-entries`)
      .send({
        type: "YOU_GAVE",
        amount: 100,
        description: "test",
        billImage: "/objects/uploads/valid-uuid",
      })
      .expect(201);

    expect(res.body.billImage).toBe("/objects/uploads/valid-uuid");
  });

  it("accepts a request without billImage", async () => {
    const app = makeApp(businessId);
    const res = await request(app)
      .post(`/parties/${partyId}/ledger-entries`)
      .send({
        type: "YOU_GAVE",
        amount: 50,
        description: "no photo",
      })
      .expect(201);

    expect(res.body.billImage).toBeNull();
  });

  it("accepts billImage: null (explicit removal intent)", async () => {
    const app = makeApp(businessId);
    const res = await request(app)
      .post(`/parties/${partyId}/ledger-entries`)
      .send({
        type: "YOU_GAVE",
        amount: 50,
        description: "explicit null photo",
        billImage: null,
      })
      .expect(201);

    expect(res.body.billImage).toBeNull();
  });
});

// ─── PATCH tests ──────────────────────────────────────────────────────────────

describe("PATCH ledger-entry — billImage prefix validation", () => {
  async function createEntry(billImage: string | null = null) {
    const [entry] = await testDb
      .insert(ledgerEntriesTable)
      .values({
        partyId,
        type: "YOU_GAVE",
        amount: "10.00",
        description: "patch validation test entry",
        billImage,
      })
      .returning();
    return entry!;
  }

  it("rejects a billImage without the /objects/ prefix with 400", async () => {
    const entry = await createEntry("/objects/uploads/existing-uuid");
    const app = makeApp(businessId);

    const res = await request(app)
      .patch(`/parties/${partyId}/ledger-entries/${entry.id}`)
      .send({ billImage: "uploads/bad-path.jpg" })
      .expect(400);

    expect(res.body.error).toMatch(/billImage must start with \/objects\//);
  });

  it("rejects a full URL as billImage with 400", async () => {
    const entry = await createEntry("/objects/uploads/existing-uuid2");
    const app = makeApp(businessId);

    const res = await request(app)
      .patch(`/parties/${partyId}/ledger-entries/${entry.id}`)
      .send({ billImage: "https://cdn.example.com/bad.jpg" })
      .expect(400);

    expect(res.body.error).toMatch(/billImage must start with \/objects\//);
  });

  it("accepts a billImage with the correct /objects/ prefix", async () => {
    const entry = await createEntry("/objects/uploads/old-uuid");
    const app = makeApp(businessId);

    const res = await request(app)
      .patch(`/parties/${partyId}/ledger-entries/${entry.id}`)
      .send({ billImage: "/objects/uploads/new-uuid" })
      .expect(200);

    expect(res.body.billImage).toBe("/objects/uploads/new-uuid");
  });

  it("accepts billImage: null to remove the photo", async () => {
    const entry = await createEntry("/objects/uploads/remove-me-uuid");
    const app = makeApp(businessId);

    const res = await request(app)
      .patch(`/parties/${partyId}/ledger-entries/${entry.id}`)
      .send({ billImage: null })
      .expect(200);

    expect(res.body.billImage).toBeNull();
  });
});
