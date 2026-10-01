import {
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

export const otpRateLimitCountersTable = pgTable(
  "otp_rate_limit_counters",
  {
    scope: text("scope").notNull(),
    keyHash: text("key_hash").notNull(),
    totalHits: integer("total_hits").notNull(),
    resetAt: timestamp("reset_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.scope, table.keyHash] }),
    index("otp_rate_limit_counters_reset_at_idx").on(table.resetAt),
  ],
);

export type OtpRateLimitCounter = typeof otpRateLimitCountersTable.$inferSelect;