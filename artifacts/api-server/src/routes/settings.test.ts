import { afterAll, beforeAll, describe, expect, it } from "vitest";
import express from "express";
import request from "supertest";
import { db, businessesTable, businessSettingsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import settingsRouter from "./settings";

describe("business settings name synchronization", () => {
  let businessId: string;
  const app = express();

  beforeAll(async () => {
    const [business] = await db.insert(businessesTable)
      .values({ name: `Settings test ${Date.now()}` })
      .returning({ id: businessesTable.id });
    businessId = business!.id;
    await db.insert(businessSettingsTable)
      .values({ businessId, storeName: "Before rename" });

    app.use(express.json());
    app.use((req, _res, next) => {
      (req as typeof req & { businessId: string }).businessId = businessId;
      next();
    });
    app.use(settingsRouter);
  });

  afterAll(async () => {
    if (!businessId) return;
    await db.delete(businessSettingsTable).where(eq(businessSettingsTable.businessId, businessId));
    await db.delete(businessesTable).where(eq(businessesTable.id, businessId));
  });

  it("updates the active book and its settings name together", async () => {
    const response = await request(app)
      .patch("/settings")
      .send({ storeName: "  Shakil Traders  " });

    expect(response.status).toBe(200);
    expect(response.body.storeName).toBe("Shakil Traders");

    const [business] = await db.select({ name: businessesTable.name })
      .from(businessesTable)
      .where(eq(businessesTable.id, businessId));
    const [settings] = await db.select({ storeName: businessSettingsTable.storeName })
      .from(businessSettingsTable)
      .where(eq(businessSettingsTable.businessId, businessId));

    expect(business?.name).toBe("Shakil Traders");
    expect(settings?.storeName).toBe("Shakil Traders");
  });

  it("rejects a blank book name without changing either stored name", async () => {
    const response = await request(app)
      .patch("/settings")
      .send({ storeName: "   " });

    expect(response.status).toBe(400);
    const [business] = await db.select({ name: businessesTable.name })
      .from(businessesTable)
      .where(eq(businessesTable.id, businessId));
    const [settings] = await db.select({ storeName: businessSettingsTable.storeName })
      .from(businessSettingsTable)
      .where(eq(businessSettingsTable.businessId, businessId));

    expect(business?.name).toBe("Shakil Traders");
    expect(settings?.storeName).toBe("Shakil Traders");
  });
});
