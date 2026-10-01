import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { db, otpRateLimitCountersTable } from "@workspace/db";
import { PostgresRateLimitStore } from "./postgresRateLimitStore";

const sharedScope = `test-${randomUUID()}`;
const expiredScope = `test-${randomUUID()}`;
const otherScope = `${sharedScope}-other`;
const windowMs = 60_000;

afterAll(async () => {
  await db.delete(otpRateLimitCountersTable).where(
    eq(otpRateLimitCountersTable.scope, sharedScope),
  );
  await db.delete(otpRateLimitCountersTable).where(
    eq(otpRateLimitCountersTable.scope, expiredScope),
  );
  await db.delete(otpRateLimitCountersTable).where(
    eq(otpRateLimitCountersTable.scope, otherScope),
  );
});

describe("PostgresRateLimitStore", () => {
  it("shares atomic counters across independent store instances and survives recreation", async () => {
    const firstInstance = new PostgresRateLimitStore(sharedScope, windowMs);
    const secondInstance = new PostgresRateLimitStore(sharedScope, windowMs);
    const results = await Promise.all(
      Array.from({ length: 24 }, (_, index) =>
        (index % 2 === 0 ? firstInstance : secondInstance).increment("same-client"),
      ),
    );

    expect(results.map((result) => result.totalHits).sort((a, b) => a - b))
      .toEqual(Array.from({ length: 24 }, (_, index) => index + 1));

    const [stored] = await db.select().from(otpRateLimitCountersTable)
      .where(eq(otpRateLimitCountersTable.scope, sharedScope));
    expect(stored?.totalHits).toBe(24);
    expect(stored?.keyHash).toMatch(/^[a-f0-9]{64}$/);
    expect(stored?.keyHash).not.toContain("same-client");

    const restartedInstance = new PostgresRateLimitStore(sharedScope, windowMs);
    expect(await restartedInstance.get("same-client")).toMatchObject({ totalHits: 24 });
  });

  it("starts a new fixed window after the previous counter expires", async () => {
    const firstInstance = new PostgresRateLimitStore(expiredScope, windowMs);
    await firstInstance.increment("expired-client");

    await db.update(otpRateLimitCountersTable)
      .set({ resetAt: new Date(Date.now() - 1_000) })
      .where(eq(otpRateLimitCountersTable.scope, expiredScope));

    const secondInstance = new PostgresRateLimitStore(expiredScope, windowMs);
    const incremented = await secondInstance.increment("expired-client");

    expect(incremented.totalHits).toBe(1);
    expect(incremented.resetTime?.getTime()).toBeGreaterThan(Date.now());
  });

  it("decrements and resets only the selected scope and key", async () => {
    const store = new PostgresRateLimitStore(sharedScope, windowMs);
    await store.increment("reset-client");
    await store.increment("reset-client");
    await store.decrement("reset-client");
    expect(await store.get("reset-client")).toMatchObject({ totalHits: 1 });

    const differentScope = new PostgresRateLimitStore(otherScope, windowMs);
    await differentScope.increment("reset-client");
    await store.resetKey("reset-client");
    expect(await store.get("reset-client")).toBeUndefined();
    expect(await differentScope.get("reset-client")).toMatchObject({ totalHits: 1 });
    await differentScope.resetAll();

    const [remaining] = await db.select().from(otpRateLimitCountersTable)
      .where(and(
        eq(otpRateLimitCountersTable.scope, otherScope),
        eq(otpRateLimitCountersTable.totalHits, 1),
      ));
    expect(remaining).toBeUndefined();
  });
});