import { pgTable, uuid, text, timestamp } from "drizzle-orm/pg-core";

/**
 * Global singleton table (at most one row) storing download/store link
 * configuration that the admin can update without redeploying.
 */
export const downloadConfigsTable = pgTable("download_configs", {
  id:              uuid("id").primaryKey().defaultRandom(),
  /** Full Play Store URL, e.g. https://play.google.com/store/apps/details?id=com.banglakhata */
  androidStoreUrl: text("android_store_url").notNull().default(""),
  /**
   * Direct APK download URL (used when no Play Store URL is set).
   * Leave blank to fall back to the file served from public/downloads/.
   */
  androidApkUrl:   text("android_apk_url").notNull().default(""),
  /** Full App Store URL, e.g. https://apps.apple.com/app/id... */
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
