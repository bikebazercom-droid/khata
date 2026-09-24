import { pgTable, text, uuid, timestamp, pgEnum, integer, primaryKey } from "drizzle-orm/pg-core";
import { businessesTable } from "./businesses";

export const userRoleEnum = pgEnum("user_role", ["owner", "staff"]);
export const loginSourceEnum = pgEnum("login_source", ["play_store", "app_store", "web"]);
export const userStatusEnum = pgEnum("user_status", ["active", "suspended"]);

export const appUsersTable = pgTable("app_users", {
  id: uuid("id").primaryKey().defaultRandom(),
  /** Set when signed in via Clerk (email / Google). Null for phone-only users. */
  clerkUserId: text("clerk_user_id").unique(),
  /** Set when signed in via custom phone OTP. Null for Clerk-only users. */
  phone: text("phone").unique(),
  /** Set only from a verified Clerk email address returned by Clerk's API. */
  verifiedEmail: text("verified_email"),
  /** Incremented at phone logout to invalidate all previously issued JWTs. */
  phoneSessionVersion: integer("phone_session_version").notNull().default(0),
  businessId: uuid("business_id")
    .notNull()
    .references(() => businessesTable.id),
  role: userRoleEnum("role").notNull().default("owner"),
  displayName: text("display_name"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  /** Which client platform the user registered from */
  loginSource: loginSourceEnum("login_source").default("web"),
  /** Device description e.g. "Samsung Galaxy S24" */
  deviceMeta: text("device_meta").default(""),
  /** Last successful login timestamp */
  lastLogin: timestamp("last_login", { withTimezone: true }),
  /** Last explicit sign-out recorded by an authenticated client. */
  lastLogout: timestamp("last_logout", { withTimezone: true }),
  /** Admin-managed status; suspended users cannot sign in */
  status: userStatusEnum("status").notNull().default("active"),
});

/** Records the Clerk sessions already counted as successful logins. */
export const appUserLoginSessionsTable = pgTable("app_user_login_sessions", {
  userId: uuid("user_id").notNull().references(() => appUsersTable.id, { onDelete: "cascade" }),
  sessionId: text("session_id").notNull(),
}, (table) => [primaryKey({ columns: [table.userId, table.sessionId] })]);

export type AppUser = typeof appUsersTable.$inferSelect;
export type InsertAppUser = typeof appUsersTable.$inferInsert;
