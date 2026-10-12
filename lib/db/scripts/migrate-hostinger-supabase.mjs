import { fileURLToPath } from "node:url";
import { Client } from "pg";
import { migrateSupabaseMigrations } from "./migration-runner.mjs";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("Set DATABASE_URL to the intended Hostinger Supabase database before migrating.");
}
if (process.env.HOSTINGER_DATABASE_MIGRATION_CONFIRM !== "apply") {
  throw new Error(
    "Set HOSTINGER_DATABASE_MIGRATION_CONFIRM=apply to confirm the target is the Hostinger database.",
  );
}

const migrationDirectory = fileURLToPath(
  new URL("../../../supabase/migrations/", import.meta.url),
);
const client = new Client({ connectionString: databaseUrl });
await client.connect();
try {
  await migrateSupabaseMigrations(client, migrationDirectory);
} finally {
  await client.end();
}
