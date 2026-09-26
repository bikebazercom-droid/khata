import { pgTable, uuid, text, timestamp, index, primaryKey } from "drizzle-orm/pg-core";
import { appUsersTable } from "./appUsers";

/** Bounded authentication audit. Only successful NEW sessions, never token refresh. */
export const userLoginEventsTable = pgTable("user_login_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => appUsersTable.id, { onDelete: "cascade" }),
  occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
  /** Null when no verified client-IP trust policy is configured. */
  ip: text("ip"),
  device: text("device").notNull(),
  authMethod: text("auth_method").notNull(),
  source: text("source").notNull(),
}, (table) => [
  index("user_login_events_user_time_idx").on(table.userId, table.occurredAt),
  index("user_login_events_time_idx").on(table.occurredAt),
]);

/** Only a foreground client can refresh this timestamp. */
export const userPresenceTable = pgTable("user_presence", {
  userId: uuid("user_id").notNull().references(() => appUsersTable.id, { onDelete: "cascade" }),
  sessionId: text("session_id").notNull(),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull(),
}, (table) => [
  primaryKey({ columns: [table.userId, table.sessionId] }),
  index("user_presence_last_seen_idx").on(table.lastSeenAt),
]);

export const blockedIpsTable = pgTable("blocked_ips", {
  ip: text("ip").primaryKey(),
  reason: text("reason"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});