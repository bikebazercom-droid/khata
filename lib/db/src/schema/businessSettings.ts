import { pgTable, text, uuid, numeric } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { businessesTable } from "./businesses";

export const businessSettingsTable = pgTable("business_settings", {
  id: uuid("id").primaryKey().defaultRandom(),
  /** Which business these settings belong to. Null for legacy rows created before multi-tenancy. */
  businessId: uuid("business_id")
    .references(() => businessesTable.id)
    .unique(),
  storeName: text("store_name").notNull().default("হাজারী খাতাবুক"),
  language: text("language").notNull().default("English"),
  onlineCollectionBalance: numeric("online_collection_balance", {
    precision: 12,
    scale: 2,
  })
    .notNull()
    .default("0"),
});

export const insertBusinessSettingsSchema = createInsertSchema(
  businessSettingsTable,
).omit({ id: true });
export type InsertBusinessSettings = z.infer<
  typeof insertBusinessSettingsSchema
>;
export type BusinessSettings = typeof businessSettingsTable.$inferSelect;
