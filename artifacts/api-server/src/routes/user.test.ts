import express, { type NextFunction, type Request, type Response } from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import {
  appUserLoginSessionsTable, appUsersTable, businessesTable, db,
  businessSettingsTable, userBusinessesTable,
} from "@workspace/db";
import {
  getOrCreateFirebaseUser, getOrCreatePhoneUser, SEED_BUSINESS_ID, type AuthenticatedRequest,
} from "../middlewares/requireAuth";
import userRouter from "./user";

describe("account deletion and client sign-out", () => {
  it("reads and updates a language preference scoped to the authenticated user", async () => {
    const [business] = await db.insert(businessesTable).values({ name: "Language preference regression" }).returning();
    const [user] = await db.insert(appUsersTable).values({
      businessId: business!.id,
      firebaseUid: `language-preference-${crypto.randomUUID()}`,
      role: "owner",
    }).returning();

    const app = express();
    app.use(express.json());
    app.use((req: Request, _res: Response, next: NextFunction) => {
      (req as AuthenticatedRequest).userId = user!.id;
      next();
    });
    app.use(userRouter);

    try {
      const initial = await request(app).get("/user/preferences");
      expect(initial.status).toBe(200);
      expect(initial.body).toEqual({ language: null });

      const saved = await request(app).patch("/user/preferences").send({ language: "en" });
      expect(saved.status).toBe(200);
      expect(saved.body).toEqual({ language: "en" });

      const reread = await request(app).get("/user/preferences");
      expect(reread.body).toEqual({ language: "en" });

      const invalid = await request(app).patch("/user/preferences").send({ language: "fr" });
      expect(invalid.status).toBe(400);
    } finally {
      await db.delete(appUsersTable).where(eq(appUsersTable.id, user!.id));
      await db.delete(businessesTable).where(eq(businessesTable.id, business!.id));
    }
  });

  it("allows a clean phone re-signup after deleting the old account and session", async () => {
    const [business] = await db.insert(businessesTable).values({ name: "Delete account regression" }).returning();
    const phone = `+88017${Math.floor(Math.random() * 1_000_000_000).toString().padStart(9, "0")}`;
    const [user] = await db.insert(appUsersTable).values({
      businessId: business!.id,
      phone,
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
    app.use(express.json());
    app.use((req: Request, _res: Response, next: NextFunction) => {
      (req as AuthenticatedRequest).userId = user!.id;
      next();
    });
    app.use(userRouter);

    const response = await request(app).delete("/user/account").send({ confirmation: "DELETE" });
    expect(response.status).toBe(200);
    const [tombstone] = await db.select().from(appUsersTable).where(eq(appUsersTable.id, user!.id));
    expect(tombstone?.workerAccessDeletedAt).toBeTruthy();
    expect(tombstone?.phone).not.toBe(phone);
    expect(tombstone?.displayName).toBeNull();
    expect(await db.select().from(businessesTable).where(eq(businessesTable.id, business!.id))).toEqual([]);
    expect(await db.select().from(appUserLoginSessionsTable).where(eq(appUserLoginSessionsTable.userId, user!.id))).toEqual([]);
    const recreated = await getOrCreatePhoneUser(phone);
    expect(recreated.id).not.toBe(user!.id);
    expect(recreated.phone).toBe(phone);
    expect(recreated.businessId).not.toBe(business!.id);

    const secondDeleteApp = express();
    secondDeleteApp.use(express.json());
    secondDeleteApp.use((req: Request, _res: Response, next: NextFunction) => {
      (req as AuthenticatedRequest).userId = recreated.id;
      next();
    });
    secondDeleteApp.use(userRouter);
    const secondDeletion = await request(secondDeleteApp).delete("/user/account").send({ confirmation: "DELETE" });
    expect(secondDeletion.status).toBe(200);
    const recreatedAgain = await getOrCreatePhoneUser(phone);
    expect(recreatedAgain.id).not.toBe(recreated.id);
    expect(recreatedAgain.phone).toBe(phone);

    await db.delete(userBusinessesTable).where(eq(userBusinessesTable.userId, recreatedAgain.id));
    await db.delete(appUsersTable).where(eq(appUsersTable.id, recreatedAgain.id));
    if (recreatedAgain.businessId !== SEED_BUSINESS_ID) {
      await db.delete(businessSettingsTable).where(eq(businessSettingsTable.businessId, recreatedAgain.businessId));
      await db.delete(businessesTable).where(eq(businessesTable.id, recreatedAgain.businessId));
    }
    await db.delete(userBusinessesTable).where(eq(userBusinessesTable.userId, recreated.id));
    await db.delete(appUsersTable).where(eq(appUsersTable.id, user!.id));
    if (recreated.businessId !== SEED_BUSINESS_ID) {
      await db.delete(businessSettingsTable).where(eq(businessSettingsTable.businessId, recreated.businessId));
      await db.delete(businessesTable).where(eq(businessesTable.id, recreated.businessId));
    }
  });

  it("requires an exact account identity or DELETE before removing any records", async () => {
    const [business] = await db.insert(businessesTable).values({ name: "Delete confirmation regression" }).returning();
    const [user] = await db.insert(appUsersTable).values({
      businessId: business!.id,
      phone: "+8801712345678",
      role: "owner",
    }).returning();

    const app = express();
    app.use(express.json());
    app.use((req: Request, _res: Response, next: NextFunction) => {
      (req as AuthenticatedRequest).userId = user!.id;
      next();
    });
    app.use(userRouter);

    try {
      const mismatch = await request(app).delete("/user/account").send({ confirmation: "wrong" });
      expect(mismatch.status).toBe(400);
      expect(await db.select().from(appUsersTable).where(eq(appUsersTable.id, user!.id))).toHaveLength(1);

      const identityMatch = await request(app).delete("/user/account").send({ confirmation: "+8801712345678" });
      expect(identityMatch.status).toBe(200);
      const [tombstone] = await db.select().from(appUsersTable).where(eq(appUsersTable.id, user!.id));
      expect(tombstone?.workerAccessDeletedAt).toBeTruthy();
    } finally {
      await db.delete(userBusinessesTable).where(eq(userBusinessesTable.userId, user!.id));
      await db.delete(appUsersTable).where(eq(appUsersTable.id, user!.id));
      await db.delete(businessesTable).where(eq(businessesTable.id, business!.id));
    }
  });

  it("tombstones the Firebase identity and app data after a valid confirmation", async () => {
    const [business] = await db.insert(businessesTable).values({ name: "Firebase account deletion regression" }).returning();
    const firebaseUid = `delete-firebase-${crypto.randomUUID()}`;
    const email = `delete-success-${crypto.randomUUID()}@example.test`;
    const [user] = await db.insert(appUsersTable).values({
      businessId: business!.id,
      firebaseUid,
      verifiedEmail: email,
      role: "owner",
    }).returning();
    await db.insert(userBusinessesTable).values({
      userId: user!.id,
      businessId: business!.id,
    });

    const app = express();
    app.use(express.json());
    app.use((req: Request, _res: Response, next: NextFunction) => {
      (req as AuthenticatedRequest).userId = user!.id;
      next();
    });
    app.use(userRouter);

    try {
      const response = await request(app).delete("/user/account").send({ confirmation: email });
      expect(response.status).toBe(200);
      const [tombstone] = await db.select().from(appUsersTable).where(eq(appUsersTable.id, user!.id));
      expect(tombstone?.workerAccessDeletedAt).toBeTruthy();
      expect(tombstone?.firebaseUid).not.toBe(firebaseUid);
      expect(await db.select().from(businessesTable).where(eq(businessesTable.id, business!.id))).toEqual([]);
      await expect(getOrCreateFirebaseUser(firebaseUid, email)).rejects.toThrow(/deleted/i);
      await expect(getOrCreateFirebaseUser(`new-provider-${crypto.randomUUID()}`, email))
        .rejects.toThrow(/deleted/i);
    } finally {
      await db.delete(userBusinessesTable).where(eq(userBusinessesTable.userId, user!.id));
      await db.delete(appUsersTable).where(eq(appUsersTable.id, user!.id));
      await db.delete(businessesTable).where(eq(businessesTable.id, business!.id));
    }
  });

  it("rejects account deletion for staff without removing their business", async () => {
    const [business] = await db.insert(businessesTable).values({ name: "Staff delete guard regression" }).returning();
    const [user] = await db.insert(appUsersTable).values({
      businessId: business!.id,
      firebaseUid: `staff-delete-regression-${crypto.randomUUID()}`,
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