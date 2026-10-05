import express from "express";
import request from "supertest";
import { afterAll, describe, expect, it } from "vitest";
import { readinessPool } from "@workspace/db";
import healthRouter from "./health";

const app = express();
app.use("/api", healthRouter);

afterAll(async () => {
  await readinessPool.end();
});

describe("readiness PostgreSQL pool integration", () => {
  it(
    "discards a client after its query timeout and serves readiness again",
    async () => {
      await readinessPool.query("select 1");

      const clientRemoved = new Promise<void>((resolve) => {
        readinessPool.once("remove", () => resolve());
      });

      const startedAt = Date.now();
      let queryError: unknown;
      try {
        // Read-only delay against the workspace database; no application data
        // or schema is changed by this integration test.
        await readinessPool.query("select pg_sleep(10)");
      } catch (error) {
        queryError = error;
      }

      expect(queryError).toBeInstanceOf(Error);
      expect((queryError as Error).message).toBe("Query read timeout");
      expect(Date.now() - startedAt).toBeLessThan(4_000);

      await clientRemoved;
      expect(readinessPool.totalCount).toBe(0);

      await request(app)
        .get("/api/readyz")
        .expect(200, { status: "ready" });

      expect(readinessPool.totalCount).toBe(1);
      expect(readinessPool.waitingCount).toBe(0);
    },
    10_000,
  );
});
