import { pgTable, text, uuid, timestamp, pgEnum } from "drizzle-orm/pg-core";
import { businessesTable } from "./businesses";

export const userRoleEnum = pgEnum("user_role", ["owner", "staff"]);

export const appUsersTable = pgTable("app_users", {
  id: uuid("id").primaryKey().defaultRandom(),
  /** Set when signed in via Clerk (email / Google). Null for phone-only users. */
  clerkUserId: text("clerk_user_id").unique(),
  /** Set when signed in via custom phone OTP. Null for Clerk-only users. */
  phone: text("phone").unique(),
  businessId: uuid("business_id")
    .notNull()
    .references(() => businessesTable.id),
  role: userRoleEnum("role").notNull().default("owner"),
  displayName: text("display_name"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type AppUser = typeof appUsersTable.$inferSelect;
export type InsertAppUser = typeof appUsersTable.$inferInsert;
