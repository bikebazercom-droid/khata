import { pgTable, uuid, text, timestamp } from "drizzle-orm/pg-core";

/**
 * Global singleton table (at most one row) storing download configuration.
 * Only the desktop URL is active; legacy store-link columns remain to preserve
 * existing database values.
 */
export const downloadConfigsTable = pgTable("download_configs", {
  id:              uuid("id").primaryKey().defaultRandom(),
  androidStoreUrl: text("android_store_url").notNull().default(""),
  androidApkUrl:   text("android_apk_url").notNull().default(""),
  iosStoreUrl:     text("ios_store_url").notNull().default(""),
  /**
   * Windows EXE download URL.
   * Leave blank to fall back to the file served from public/downloads/.
   */
  windowsExeUrl:   text("windows_exe_url").notNull().default(""),
  updatedAt:       timestamp("updated_at", { withTimezone: true }),
});

export type DownloadConfig    = typeof downloadConfigsTable.$inferSelect;
export type InsertDownloadConfig = typeof downloadConfigsTable.$inferInsert;
