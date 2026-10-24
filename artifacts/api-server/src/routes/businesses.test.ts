import express, { type NextFunction, type Request, type Response } from "express";
import request from "supertest";
import { afterEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import {
  appUsersTable,
  businessesTable,
  businessSettingsTable,
  db,
  userBusinessesTable,
} from "@workspace/db";
import type { AuthenticatedRequest } from "../middlewares/requireAuth";
import businessesRouter from "./businesses";

describe("business creation", () => {
  let userId: string | undefined;
  let businessId: string | undefined;
  let ownerBusinessId: string | undefined;

  afterEach(async () => {
    if (businessId) {
      await db.delete(userBusinessesTable).where(eq(userBusinessesTable.businessId, businessId));
      await db.delete(businessSettingsTable).where(eq(businessSettingsTable.businessId, businessId));
      await db.delete(businessesTable).where(eq(businessesTable.id, businessId));
      businessId = undefined;
    }
    if (userId) {
      await db.delete(appUsersTable).where(eq(appUsersTable.id, userId));
      userId = undefined;
    }
    if (ownerBusinessId) {
      await db.delete(businessesTable).where(eq(businessesTable.id, ownerBusinessId));
      ownerBusinessId = undefined;
    }
  });

  it("creates a business, its settings, and the owner membership together", async () => {
    const [ownerBusiness] = await db.insert(businessesTable)
      .values({ name: "Business route test owner" }).returning();
    ownerBusinessId = ownerBusiness!.id;
    const [owner] = await db.insert(appUsersTable).values({
      businessId: ownerBusiness!.id,
      firebaseUid: `business-create-${crypto.randomUUID()}`,
      role: "owner",
    }).returning();
    userId = owner!.id;

    const app = express();
    app.use(express.json());
    app.use((req: Request, _res: Response, next: NextFunction) => {
      (req as AuthenticatedRequest).userId = userId!;
      next();
    });
    app.use(businessesRouter);

    const response = await request(app).post("/businesses").send({ name: "  New ledger  " });
    expect(response.status).toBe(201);
    expect(response.body.name).toBe("New ledger");

    businessId = response.body.id as string;
    expect(await db.select().from(businessSettingsTable)
      .where(eq(businessSettingsTable.businessId, businessId))).toHaveLength(1);
    expect(await db.select().from(userBusinessesTable).where(eq(
      userBusinessesTable.userId,
      userId!,
    ))).toEqual(expect.arrayContaining([
      expect.objectContaining({ businessId }),
    ]));
  });

  it("rejects blank or malformed business names without writing rows", async () => {
    const app = express();
    app.use(express.json());
    app.use((req: Request, _res: Response, next: NextFunction) => {
      (req as AuthenticatedRequest).userId = "00000000-0000-0000-0000-000000000001";
      next();
    });
    app.use(businessesRouter);

    expect((await request(app).post("/businesses").send({ name: "  " })).status).toBe(400);
    expect((await request(app).post("/businesses")
      .set("Content-Type", "application/json")
      .send("null")).status).toBe(400);
  });
});
