import { pgTable, uuid, text, integer, timestamp, boolean } from "drizzle-orm/pg-core";

export const adminOtpConfigTable = pgTable("admin_otp_config", {
  id: uuid("id").primaryKey().defaultRandom(),
  gatewayUrl: text("gateway_url").notNull().default(""),
  apiKey: text("api_key").notNull().default(""),
  remainingBalance: integer("remaining_balance").notNull().default(0),
  updatedAt: timestamp("updated_at", { withTimezone: true }),
  enabled: boolean("enabled").notNull().default(true),
  sender: text("sender").notNull().default(""),
});

export type AdminOtpConfig = typeof adminOtpConfigTable.$inferSelect;
export type InsertAdminOtpConfig = typeof adminOtpConfigTable.$inferInsert;
