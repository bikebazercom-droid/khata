import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { copyFile, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { Client } from "pg";
import { loadMigrations, migrateSupabaseMigrations } from "./migration-runner.mjs";

const databaseUrl = process.env.MIGRATION_TEST_DATABASE_URL;
const projectMigrations = fileURLToPath(
  new URL("../../../supabase/migrations/", import.meta.url),
);
const allowedLocalHosts = new Set(["localhost", "127.0.0.1", "::1"]);

function requireLocalDatabaseUrl(value) {
  if (!value) {
    throw new Error("MIGRATION_TEST_DATABASE_URL is required for the PostgreSQL integration test.");
  }
  const parsed = new URL(value);
  const host = parsed.hostname.replace(/^\[|\]$/g, "");
  if (!allowedLocalHosts.has(host)) {
    throw new Error(
      "Migration integration tests only accept localhost, 127.0.0.1, or ::1; production hosts are refused.",
    );
  }
  return parsed;
}

test(
  "real PostgreSQL applies checked-in migrations once and rolls failed DDL back",
  { skip: !databaseUrl && "Set MIGRATION_TEST_DATABASE_URL to a local PostgreSQL admin URL." },
  async () => {
    const baseUrl = requireLocalDatabaseUrl(databaseUrl);
    const databaseName = `khata_migration_test_${process.pid}_${randomBytes(4).toString("hex")}`;
    const adminClient = new Client({ connectionString: baseUrl.toString() });
    await adminClient.connect();

    let migrationClient;
    try {
      await adminClient.query(`CREATE DATABASE "${databaseName}"`);
      const testUrl = new URL(baseUrl);
      testUrl.pathname = `/${databaseName}`;
      migrationClient = new Client({ connectionString: testUrl.toString() });
      await migrationClient.connect();

      await migrationClient.query(`
        CREATE TABLE public.ledger_entries (
          id uuid PRIMARY KEY,
          amount numeric(12, 2) NOT NULL,
          party_id uuid NOT NULL,
          created_at timestamptz NOT NULL,
          transfer_party_id uuid,
          linked_entry_id uuid
        );
        CREATE TABLE public.parties (
          id uuid PRIMARY KEY,
          current_balance numeric(12, 2) NOT NULL DEFAULT 0,
          business_id uuid NOT NULL,
          last_transaction_at timestamptz,
          created_at timestamptz NOT NULL DEFAULT now()
        );
        CREATE TABLE public.business_settings (
          id uuid PRIMARY KEY,
          online_collection_balance numeric(12, 2) NOT NULL DEFAULT 0
        );
        CREATE TABLE public.download_configs (id uuid PRIMARY KEY);
        CREATE TABLE public.app_users (id uuid PRIMARY KEY);
        CREATE TABLE public.businesses (id uuid PRIMARY KEY);
      `);

      const logger = { info() {} };
      const migrations = await loadMigrations(projectMigrations);
      assert.ok(migrations.length > 0, "expected checked-in migrations");
      assert.equal(
        await migrateSupabaseMigrations(migrationClient, projectMigrations, logger),
        migrations.length,
      );
      const appliedRows = await migrationClient.query(
        "SELECT version, checksum FROM public.banglakhata_schema_migrations ORDER BY version",
      );
      assert.equal(appliedRows.rowCount, migrations.length);
      assert.equal(
        await migrateSupabaseMigrations(migrationClient, projectMigrations, logger),
        0,
        "a second run must not reapply recorded migrations",
      );

      const failureDirectory = await mkdtemp(path.join(os.tmpdir(), "khata-migration-failure-"));
      try {
        for (const entry of await readdir(projectMigrations, { withFileTypes: true })) {
          if (entry.isFile() && entry.name.endsWith(".sql")) {
            await copyFile(
              path.join(projectMigrations, entry.name),
              path.join(failureDirectory, entry.name),
            );
          }
        }
        const failingVersion = "99991231_999999";
        await writeFile(
          path.join(failureDirectory, `${failingVersion}_rollback_probe.sql`),
          `CREATE TABLE public.migration_rollback_probe (id integer);\nSELECT 1 / 0;`,
          "utf8",
        );
        await assert.rejects(
          migrateSupabaseMigrations(migrationClient, failureDirectory, logger),
          /division by zero/,
        );
        const rollbackState = await migrationClient.query(`
          SELECT
            to_regclass('public.migration_rollback_probe') IS NULL AS table_rolled_back,
            NOT EXISTS (
              SELECT 1 FROM public.banglakhata_schema_migrations WHERE version = '${failingVersion}'
            ) AS registry_row_rolled_back
        `);
        assert.equal(rollbackState.rows[0].table_rolled_back, true);
        assert.equal(rollbackState.rows[0].registry_row_rolled_back, true);
      } finally {
        await rm(failureDirectory, { recursive: true, force: true });
      }
    } finally {
      await migrationClient?.end();
      await adminClient.query(
        `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${databaseName}'`,
      ).catch(() => undefined);
      await adminClient.query(`DROP DATABASE IF EXISTS "${databaseName}"`).catch(() => undefined);
      await adminClient.end();
    }
  },
);
