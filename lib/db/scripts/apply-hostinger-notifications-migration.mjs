import { readFile } from "node:fs/promises";
import { Client } from "pg";
import { fileURLToPath } from "node:url";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("Set DATABASE_URL to the Hostinger Supabase database before running this migration.");
}
if (process.env.HOSTINGER_DATABASE_MIGRATION_CONFIRM !== "apply") {
  throw new Error(
    "Set HOSTINGER_DATABASE_MIGRATION_CONFIRM=apply to confirm the target is the Hostinger production database.",
  );
}

const migrationPath = fileURLToPath(
  new URL("../../../supabase/migrations/20261012_000002_add_notifications_and_owner_push_tokens.sql", import.meta.url),
);
const migrationSql = await readFile(migrationPath, "utf8");
const client = new Client({ connectionString: databaseUrl });

await client.connect();
try {
  await client.query("BEGIN");
  await client.query(migrationSql);
  await client.query("COMMIT");
  console.info("Notifications and owner push token migration committed.");
} catch (error) {
  await client.query("ROLLBACK").catch(() => undefined);
  throw error;
} finally {
  await client.end();
}
