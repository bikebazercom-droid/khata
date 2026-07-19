import { pgTable, uuid, timestamp, primaryKey } from "drizzle-orm/pg-core";
import { businessesTable } from "./businesses";
import { appUsersTable } from "./appUsers";

/**
 * Many-to-many: one user may own multiple businesses.
 * Populated automatically by JIT provisioning in requireAuth.ts.
 */
export const userBusinessesTable = pgTable(
  "user_businesses",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => appUsersTable.id, { onDelete: "cascade" }),
    businessId: uuid("business_id")
      .notNull()
      .references(() => businessesTable.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.businessId] })],
);

export type UserBusiness = typeof userBusinessesTable.$inferSelect;
