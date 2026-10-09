import { pgTable, uuid, text, timestamp } from "drizzle-orm/pg-core";

/**
 * Global singleton table (at most one row) storing public download and report
 * branding configuration. Existing store-link columns remain for compatibility.
 */
export const downloadConfigsTable = pgTable("download_configs", {
  id:              uuid("id").primaryKey().defaultRandom(),
  androidStoreUrl: text("android_store_url").notNull().default(""),
  androidApkUrl:   text("android_apk_url").notNull().default(""),
  iosStoreUrl:     text("ios_store_url").notNull().default(""),
  websiteUrl:      text("website_url").notNull().default(""),
  supportPhone:    text("support_phone").notNull().default(""),
  supportEmail:    text("support_email").notNull().default(""),
  /**
   * Windows EXE download URL.
   * Leave blank to fall back to the file served from public/downloads/.
   */
  windowsExeUrl:   text("windows_exe_url").notNull().default(""),
  updatedAt:       timestamp("updated_at", { withTimezone: true }),
});

export type DownloadConfig    = typeof downloadConfigsTable.$inferSelect;
export type InsertDownloadConfig = typeof downloadConfigsTable.$inferInsert;
