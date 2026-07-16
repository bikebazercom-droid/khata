import {
  pgTable,
  text,
  uuid,
  timestamp,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { businessesTable } from "./businesses";

/**
 * Immutable audit log of every staff deployment action.
 * staffName is stored as a snapshot so history is preserved
 * even if the staff member is later removed from the personnel table.
 */
export const staffDeploymentLogsTable = pgTable("staff_deployment_logs", {
  id: uuid("id").primaryKey().defaultRandom(),
  businessId: uuid("business_id")
    .notNull()
    .references(() => businessesTable.id),
  /** Nullable — staff member may be deleted but log must survive. */
  staffId: uuid("staff_id"),
  /** Snapshot of name at time of deployment. */
  staffName: text("staff_name").notNull(),
  destination: text("destination").notNull(),
  deployedAt: timestamp("deployed_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const insertStaffDeploymentLogSchema = createInsertSchema(
  staffDeploymentLogsTable,
).omit({ id: true, deployedAt: true });

export type InsertStaffDeploymentLog = z.infer<
  typeof insertStaffDeploymentLogSchema
>;
export type StaffDeploymentLog = typeof staffDeploymentLogsTable.$inferSelect;
