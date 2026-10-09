import { randomUUID } from "node:crypto";
import express, { type NextFunction, type Request, type Response } from "express";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "@workspace/db";
import { businessesTable, partiesTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import partiesRouter from "./parties";
import type { AuthenticatedRequest } from "../middlewares/requireAuth";

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
    (req as unknown as AuthenticatedRequest).userId = "name-only-party-test";
    (req as unknown as AuthenticatedRequest).role = "owner";
    next();
  });
  app.use(partiesRouter);
  app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
  });
  return app;
}

let businessId: string | undefined;

beforeAll(async () => {
  const [business] = await testDb
    .insert(businessesTable)
    .values({ name: `Name-only party API test ${randomUUID()}` })
    .returning({ id: businessesTable.id });

  if (!business) throw new Error("Could not create the name-only party test business");
  businessId = business.id;
});

afterAll(async () => {
  if (businessId) {
    await testDb.delete(partiesTable).where(eq(partiesTable.businessId, businessId));
    await testDb.delete(businessesTable).where(eq(businessesTable.id, businessId));
  }
  await pool.end();
});

describe("POST /parties without a phone number", () => {
  it.each(["CUSTOMER", "SUPPLIER"] as const)(
    "creates and persists a name-only %s",
    async (role) => {
      if (!businessId) throw new Error("Test business was not initialized");
      const name = `Name-only ${role} ${randomUUID()}`;

      const response = await request(makeApp(businessId))
        .post("/parties")
        .send({ name, role })
        .expect(201);

      expect(response.body).toMatchObject({
        name,
        phone: "",
        role,
        currentBalance: 0,
        balanceType: "YOU_WILL_GET",
        dueDate: null,
        lastTransactionAt: null,
      });
      expect(response.body.id).toEqual(expect.any(String));

      const [persisted] = await testDb
        .select()
        .from(partiesTable)
        .where(eq(partiesTable.id, response.body.id));

      expect(persisted).toMatchObject({
        businessId,
        name,
        phone: "",
        role,
      });
    },
  );
});
