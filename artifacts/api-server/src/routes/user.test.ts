import express, { type NextFunction, type Request, type Response } from "express";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { appUserLoginSessionsTable, appUsersTable, businessesTable, db, userBusinessesTable } from "@workspace/db";
import { type AuthenticatedRequest } from "../middlewares/requireAuth";
import userRouter from "./user";

describe("account deletion and client sign-out", () => {
  it("leaves no replacement user, business, or sign-in session after deletion", async () => {
    const [business] = await db.insert(businessesTable).values({ name: "Delete account regression" }).returning();
    const clerkUserId = `delete-regression-${crypto.randomUUID()}`;
    const [user] = await db.insert(appUsersTable).values({
      businessId: business!.id,
      clerkUserId,
      role: "owner",
    }).returning();
    await db.insert(userBusinessesTable).values({
      userId: user!.id,
      businessId: business!.id,
    });
    await db.insert(appUserLoginSessionsTable).values({
      userId: user!.id,
      sessionId: `session-${crypto.randomUUID()}`,
    });

    const app = express();
    app.use((req: Request, _res: Response, next: NextFunction) => {
      (req as AuthenticatedRequest).userId = user!.id;
      next();
    });
    app.use(userRouter);

    const response = await request(app).delete("/user/account");
    expect(response.status).toBe(200);
    // Clerk signOut is performed client-side after this response. No authenticated
    // application API request (including logout-event) may run between the two.
    expect(await db.select().from(appUsersTable).where(eq(appUsersTable.clerkUserId, clerkUserId))).toEqual([]);
    expect(await db.select().from(businessesTable).where(eq(businessesTable.id, business!.id))).toEqual([]);
    expect(await db.select().from(appUserLoginSessionsTable).where(eq(appUserLoginSessionsTable.userId, user!.id))).toEqual([]);
  });

  it("rejects account deletion for staff without removing their business", async () => {
    const [business] = await db.insert(businessesTable).values({ name: "Staff delete guard regression" }).returning();
    const [user] = await db.insert(appUsersTable).values({
      businessId: business!.id,
      clerkUserId: `staff-delete-regression-${crypto.randomUUID()}`,
      role: "staff",
    }).returning();
    await db.insert(userBusinessesTable).values({
      userId: user!.id,
      businessId: business!.id,
    });

    const app = express();
    app.use((req: Request, _res: Response, next: NextFunction) => {
      (req as AuthenticatedRequest).userId = user!.id;
      next();
    });
    app.use(userRouter);

    try {
      const response = await request(app).delete("/user/account");
      expect(response.status).toBe(403);
      expect(await db.select().from(appUsersTable).where(eq(appUsersTable.id, user!.id))).toHaveLength(1);
      expect(await db.select().from(businessesTable).where(eq(businessesTable.id, business!.id))).toHaveLength(1);
    } finally {
      await db.delete(userBusinessesTable).where(eq(userBusinessesTable.userId, user!.id));
      await db.delete(appUsersTable).where(eq(appUsersTable.id, user!.id));
      await db.delete(businessesTable).where(eq(businessesTable.id, business!.id));
    }
  });
});