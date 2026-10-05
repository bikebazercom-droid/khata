import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL must be set. Did you forget to provision a database?",
  );
}

export const pool = new Pool({ connectionString: process.env.DATABASE_URL });
export const db = drizzle(pool, { schema });

// Keep health probes isolated from normal database traffic and bound both
// connection acquisition and query execution so a stalled probe can't occupy
// the application pool indefinitely.
export const readinessPool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 1,
  connectionTimeoutMillis: 2_000,
  query_timeout: 2_000,
  statement_timeout: 2_000,
});
export const readinessDb = drizzle(readinessPool, { schema });

export * from "./schema";
