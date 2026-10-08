import { createServer } from "node:net";
import express from "express";
import request from "supertest";
import { afterAll, describe, expect, it } from "vitest";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { pool, readinessDb, readinessPool } from "@workspace/db";
import * as schema from "@workspace/db/schema";
import { sql } from "drizzle-orm";
import healthRouter, { createHealthRouter } from "./health";

const { Pool } = pg;

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

  it(
    "bounds a stalled PostgreSQL handshake and shares the in-flight connection attempt",
    async () => {
      let connectionAttempts = 0;
      const sockets = new Set<import("node:net").Socket>();
      const stalledServer = createServer((socket) => {
        connectionAttempts += 1;
        sockets.add(socket);
        socket.once("close", () => sockets.delete(socket));
        // Accept TCP, but never send PostgreSQL's authentication/startup response.
      });

      await new Promise<void>((resolve, reject) => {
        stalledServer.once("error", reject);
        stalledServer.listen(0, "127.0.0.1", () => {
          stalledServer.off("error", reject);
          resolve();
        });
      });

      const address = stalledServer.address();
      if (!address || typeof address === "string") {
        throw new Error("Failed to bind stalled PostgreSQL test endpoint");
      }

      const stalledPool = new Pool({
        host: "127.0.0.1",
        port: address.port,
        user: "readiness_test",
        password: "readiness_test",
        database: "readiness_test",
        max: 1,
        connectionTimeoutMillis: 2_000,
        query_timeout: 1_500,
        statement_timeout: 5_000,
      });

      try {
        let probeDb = drizzle(stalledPool, { schema });
        const probeApp = express();
        probeApp.use(
          "/api",
          createHealthRouter(() => probeDb.execute(sql`select 1`)),
        );

        const startedAt = Date.now();
        const responses = await Promise.all(
          Array.from({ length: 5 }, () =>
            request(probeApp).get("/api/readyz"),
          ),
        );

        expect(Date.now() - startedAt).toBeLessThan(1_500);
        for (const response of responses) {
          expect(response.status).toBe(503);
          expect(response.body).toEqual({ status: "not_ready" });
        }
        expect(connectionAttempts).toBe(1);

        const ledgerProbe = await pool.query("select 1 as ok");
        expect(ledgerProbe.rows[0]?.ok).toBe(1);

        // Allow the readiness pool's connection-acquisition timeout to retire
        // the stalled client; concurrent HTTP probes must not start more TCP
        // attempts while this check is in flight.
        await new Promise((resolve) => setTimeout(resolve, 1_100));
        expect(connectionAttempts).toBe(1);
        expect(stalledPool.totalCount).toBe(0);
        expect(stalledPool.waitingCount).toBe(0);

        // Restore the same route to the normal readiness database and verify
        // it can recover after the isolated handshake failure.
        probeDb = readinessDb;
        await request(probeApp)
          .get("/api/readyz")
          .expect(200, { status: "ready" });
      } finally {
        for (const socket of sockets) socket.destroy();
        await stalledPool.end();
        await new Promise<void>((resolve, reject) => {
          stalledServer.close((error) => {
            if (error) reject(error);
            else resolve();
          });
        });
      }
    },
    10_000,
  );
});
