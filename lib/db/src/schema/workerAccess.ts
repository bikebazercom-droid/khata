import { pgTable, text, uuid, timestamp, jsonb, pgEnum, primaryKey, uniqueIndex } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { businessesTable } from "./businesses";
import { appUsersTable } from "./appUsers";
import { partiesTable } from "./parties";

export const workerInviteStatusEnum = pgEnum("worker_invite_status", ["pending", "claimed", "revoked"]);

export const workerInvitesTable = pgTable("worker_invites", {
  id: uuid("id").primaryKey().defaultRandom(),
  businessId: uuid("business_id").notNull().references(() => businessesTable.id, { onDelete: "cascade" }),
  email: text("email"),
  phone: text("phone"),
  partyIds: jsonb("party_ids").$type<string[]>().notNull().default([]),
  status: workerInviteStatusEnum("status").notNull().default("pending"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  claimedAt: timestamp("claimed_at", { withTimezone: true }),
  claimedUserId: uuid("claimed_user_id").references(() => appUsersTable.id, { onDelete: "set null" }),
}, (t) => [
  uniqueIndex("worker_invites_pending_email_unique")
    .on(sql`lower(${t.email})`)
    .where(sql`${t.status} = 'pending' AND ${t.email} IS NOT NULL`),
  uniqueIndex("worker_invites_pending_phone_unique")
    .on(t.phone)
    .where(sql`${t.status} = 'pending' AND ${t.phone} IS NOT NULL`),
]);

export const workerPartyAssignmentsTable = pgTable("worker_party_assignments", {
  userId: uuid("user_id").notNull().references(() => appUsersTable.id, { onDelete: "cascade" }),
  partyId: uuid("party_id").notNull().references(() => partiesTable.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [primaryKey({ columns: [t.userId, t.partyId] })]);