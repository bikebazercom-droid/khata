import { createHmac } from "node:crypto";
import { and, eq, gt, lte, sql } from "drizzle-orm";
import type { Store } from "express-rate-limit";
import { db, otpRateLimitCountersTable } from "@workspace/db";
import { logger } from "./logger";

const CLEANUP_INTERVAL_MS = 5 * 60_000;

let lastCleanupAt = 0;
let cleanupInFlight: Promise<void> | null = null;

function cleanupExpiredCounters(): Promise<void> {
  const now = Date.now();
  if (cleanupInFlight) return cleanupInFlight;
  if (now - lastCleanupAt < CLEANUP_INTERVAL_MS) return Promise.resolve();

  lastCleanupAt = now;
  cleanupInFlight = db
    .delete(otpRateLimitCountersTable)
    .where(lte(otpRateLimitCountersTable.resetAt, new Date(now)))
    .then(() => undefined)
    .catch(() => {
      // Cleanup is best-effort; the atomic increment still fails closed if DB is unavailable.
      logger.warn("Unable to clean expired OTP rate-limit counters");
    })
    .finally(() => {
      cleanupInFlight = null;
    });
  return cleanupInFlight;
}

/**
 * Shared PostgreSQL-backed express-rate-limit store.
 * Raw IPs and phone numbers never reach the database; each key is HMACed with
 * the same server secret used by every API instance.
 */
export class PostgresRateLimitStore implements Store {
  readonly localKeys = false;

  constructor(
    private readonly scope: string,
    private readonly windowMs: number,
  ) {
    if (!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(scope)) {
      throw new Error("Invalid rate-limit scope");
    }
    if (!Number.isSafeInteger(windowMs) || windowMs <= 0) {
      throw new Error("Rate-limit window must be a positive integer");
    }
  }

  private hashKey(key: string): string {
    const secret = process.env.SESSION_SECRET;
    if (!secret) {
      throw new Error("SESSION_SECRET is required for persistent OTP rate limits");
    }
    return createHmac("sha256", secret)
      .update(this.scope)
      .update("\0")
      .update(key)
      .digest("hex");
  }

  async get(key: string) {
    const keyHash = this.hashKey(key);
    const [counter] = await db
      .select({
        totalHits: otpRateLimitCountersTable.totalHits,
        resetAt: otpRateLimitCountersTable.resetAt,
      })
      .from(otpRateLimitCountersTable)
      .where(and(
        eq(otpRateLimitCountersTable.scope, this.scope),
        eq(otpRateLimitCountersTable.keyHash, keyHash),
        sql`${otpRateLimitCountersTable.resetAt} > now()`,
      ))
      .limit(1);

    return counter
      ? { totalHits: counter.totalHits, resetTime: counter.resetAt }
      : undefined;
  }

  async increment(key: string) {
    await cleanupExpiredCounters();
    const keyHash = this.hashKey(key);
    const [counter] = await db
      .insert(otpRateLimitCountersTable)
      .values({
        scope: this.scope,
        keyHash,
        totalHits: 1,
        resetAt: sql`now() + (${this.windowMs} * interval '1 millisecond')`,
      })
      .onConflictDoUpdate({
        target: [
          otpRateLimitCountersTable.scope,
          otpRateLimitCountersTable.keyHash,
        ],
        set: {
          totalHits: sql`CASE
            WHEN ${otpRateLimitCountersTable.resetAt} <= now() THEN 1
            ELSE ${otpRateLimitCountersTable.totalHits} + 1
          END`,
          resetAt: sql`CASE
            WHEN ${otpRateLimitCountersTable.resetAt} <= now()
              THEN now() + (${this.windowMs} * interval '1 millisecond')
            ELSE ${otpRateLimitCountersTable.resetAt}
          END`,
        },
      })
      .returning({
        totalHits: otpRateLimitCountersTable.totalHits,
        resetAt: otpRateLimitCountersTable.resetAt,
      });

    if (!counter) throw new Error("Unable to increment OTP rate-limit counter");
    return { totalHits: counter.totalHits, resetTime: counter.resetAt };
  }

  async decrement(key: string): Promise<void> {
    const keyHash = this.hashKey(key);
    await db
      .update(otpRateLimitCountersTable)
      .set({
        totalHits: sql`GREATEST(${otpRateLimitCountersTable.totalHits} - 1, 0)`,
      })
      .where(and(
        eq(otpRateLimitCountersTable.scope, this.scope),
        eq(otpRateLimitCountersTable.keyHash, keyHash),
        gt(otpRateLimitCountersTable.totalHits, 0),
        sql`${otpRateLimitCountersTable.resetAt} > now()`,
      ));
  }

  async resetKey(key: string): Promise<void> {
    const keyHash = this.hashKey(key);
    await db
      .delete(otpRateLimitCountersTable)
      .where(and(
        eq(otpRateLimitCountersTable.scope, this.scope),
        eq(otpRateLimitCountersTable.keyHash, keyHash),
      ));
  }

  async resetAll(): Promise<void> {
    await db
      .delete(otpRateLimitCountersTable)
      .where(eq(otpRateLimitCountersTable.scope, this.scope));
  }
}