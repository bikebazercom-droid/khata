import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { eq, or } from "drizzle-orm";
import {
  appUsersTable, businessesTable, businessSettingsTable, db, userBusinessesTable,
} from "@workspace/db";
import {
  getOrCreateFirebaseUser, getOrCreatePhoneUser, SEED_BUSINESS_ID,
} from "../middlewares/requireAuth";

describe("public account provisioning", () => {
  const uid = `public-signup-${randomUUID()}`;
  const email = `${uid}@example.test`;
  const phone = `+88018${String(parseInt(randomUUID().replaceAll("-", "").slice(0, 8), 16) % 100_000_000).padStart(8, "0")}`;

  afterAll(async () => {
    const users = await db.select().from(appUsersTable)
      .where(or(eq(appUsersTable.firebaseUid, uid), eq(appUsersTable.phone, phone)));
    for (const user of users) {
      await db.delete(userBusinessesTable).where(eq(userBusinessesTable.userId, user.id));
      await db.delete(appUsersTable).where(eq(appUsersTable.id, user.id));
      await db.delete(businessSettingsTable).where(eq(businessSettingsTable.businessId, user.businessId));
      await db.delete(businessesTable).where(eq(businessesTable.id, user.businessId));
    }
  });

  it("creates one private Google owner for simultaneous verified-identity requests without an allowlist", async () => {
    // Provider token verification happens in the route before this helper.
    const users = await Promise.all([0, 1].map(() =>
      getOrCreateFirebaseUser(uid, email, "Public signup test")));
    expect(users[0]!.id).toBe(users[1]!.id);
    expect(users[0]).toMatchObject({ role: "owner", status: "active", firebaseUid: uid });
    expect(users[0]!.businessId).not.toBe(SEED_BUSINESS_ID);
    expect(await db.select().from(userBusinessesTable)
      .where(eq(userBusinessesTable.userId, users[0]!.id))).toHaveLength(1);
  });

  it("creates one private phone owner for simultaneous verified-number requests", async () => {
    const users = await Promise.all([0, 1].map(() => getOrCreatePhoneUser(phone)));
    expect(users[0]!.id).toBe(users[1]!.id);
    expect(users[0]).toMatchObject({ role: "owner", status: "active", phone });
    expect(users[0]!.businessId).not.toBe(SEED_BUSINESS_ID);
    const [googleOwner] = await db.select().from(appUsersTable)
      .where(eq(appUsersTable.firebaseUid, uid));
    expect(users[0]!.businessId).not.toBe(googleOwner!.businessId);
    expect(await db.select().from(userBusinessesTable)
      .where(eq(userBusinessesTable.userId, users[0]!.id))).toHaveLength(1);
  });
});
