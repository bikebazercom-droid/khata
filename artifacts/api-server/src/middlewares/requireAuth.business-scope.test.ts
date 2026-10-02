import express, { type Request, type Response } from "express";
import request from "supertest";
import jwt from "jsonwebtoken";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { eq, inArray } from "drizzle-orm";
import {
  appUsersTable, businessesTable, db, userBusinessesTable,
} from "@workspace/db";
import { requireAuth, type AuthenticatedRequest } from "./requireAuth";

vi.mock("@clerk/express", () => ({
  getAuth: () => ({ userId: null }),
}));

describe("phone-session business selection", () => {
  let defaultBusinessId: string;
  let selectedBusinessId: string;
  let unrelatedBusinessId: string;
  let userId: string;
  let token: string;
  const app = express();

  app.get("/scope", requireAuth, (req: Request, res: Response) => {
    res.json({ businessId: (req as AuthenticatedRequest).businessId });
  });

  beforeAll(async () => {
    const [defaultBusiness, selectedBusiness, unrelatedBusiness] = await Promise.all([
      db.insert(businessesTable).values({ name: "Scope default test" }).returning(),
      db.insert(businessesTable).values({ name: "Scope selected test" }).returning(),
      db.insert(businessesTable).values({ name: "Scope unrelated test" }).returning(),
    ]).then((rows) => rows.map((items) => items[0]!));
    defaultBusinessId = defaultBusiness.id;
    selectedBusinessId = selectedBusiness.id;
    unrelatedBusinessId = unrelatedBusiness.id;

    const phone = `+88018${Math.floor(Math.random() * 100_000_000).toString().padStart(8, "0")}`;
    const [user] = await db.insert(appUsersTable).values({
      businessId: defaultBusinessId,
      phone,
      role: "owner",
    }).returning();
    userId = user!.id;
    await db.insert(userBusinessesTable).values([
      { userId, businessId: defaultBusinessId },
      { userId, businessId: selectedBusinessId },
    ]);
    token = jwt.sign({
      userId,
      businessId: defaultBusinessId,
      phone,
      sessionVersion: user!.phoneSessionVersion,
    }, process.env.SESSION_SECRET!);
  });

  afterAll(async () => {
    if (userId) {
      await db.delete(userBusinessesTable).where(eq(userBusinessesTable.userId, userId));
      await db.delete(appUsersTable).where(eq(appUsersTable.id, userId));
    }
    const ids = [defaultBusinessId, selectedBusinessId, unrelatedBusinessId].filter(Boolean);
    if (ids.length) await db.delete(businessesTable).where(inArray(businessesTable.id, ids));
  });

  it("uses the selected business for a phone-authenticated owner", async () => {
    const response = await request(app).get("/scope")
      .set("Authorization", `Bearer ${token}`)
      .set("X-Business-Id", selectedBusinessId);

    expect(response.status, response.text).toBe(200);
    expect(response.body.businessId).toBe(selectedBusinessId);
  });

  it("uses the default business when no selection is supplied", async () => {
    const response = await request(app).get("/scope")
      .set("Authorization", `Bearer ${token}`);

    expect(response.status, response.text).toBe(200);
    expect(response.body.businessId).toBe(defaultBusinessId);
  });

  it("denies an unowned selection instead of returning default-business data", async () => {
    const response = await request(app).get("/scope")
      .set("Authorization", `Bearer ${token}`)
      .set("X-Business-Id", unrelatedBusinessId);

    expect(response.status).toBe(403);
    expect(response.body.businessId).toBeUndefined();
  });
});