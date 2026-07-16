import {
  pgTable,
  text,
  uuid,
  integer,
  timestamp,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { businessesTable } from "./businesses";

/**
 * Staff members in the circular duty queue.
 * Completely isolated from the customer ledger / financial tables.
 */
export const staffPersonnelTable = pgTable("staff_personnel", {
  id: uuid("id").primaryKey().defaultRandom(),
  /** Tenant isolation — same business_id scheme as all other tables. */
  businessId: uuid("business_id")
    .notNull()
    .references(() => businessesTable.id),
  name: text("name").notNull(),
  /**
   * Circular queue position. Lower = closer to the front.
   * When a staff member is deployed they are reassigned to MAX + 1,
   * effectively moving them to the absolute back of the queue.
   */
  queueOrder: integer("queue_order").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const insertStaffPersonnelSchema = createInsertSchema(
  staffPersonnelTable,
).omit({ id: true, createdAt: true });

export type InsertStaffPersonnel = z.infer<typeof insertStaffPersonnelSchema>;
export type StaffPersonnel = typeof staffPersonnelTable.$inferSelect;
