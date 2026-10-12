import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { loadMigrations, migrateSupabaseMigrations } from "./migration-runner.mjs";

class MockPgClient {
  migrations = new Map();
  executedSql = [];
  transactionOpen = false;
  rolledBack = 0;

  async query(query, params = []) {
    const sql = query.trim();
    if (sql.startsWith("SELECT pg_advisory_")) return { rows: [] };
    if (sql === "BEGIN") {
      this.transactionOpen = true;
      return { rows: [] };
    }
    if (sql === "COMMIT") {
      this.transactionOpen = false;
      return { rows: [] };
    }
    if (sql === "ROLLBACK") {
      this.transactionOpen = false;
      this.rolledBack += 1;
      return { rows: [] };
    }
    if (sql.startsWith("CREATE TABLE IF NOT EXISTS")) return { rows: [] };
    if (sql.startsWith("SELECT checksum")) {
      const row = this.migrations.get(params[0]);
      return { rows: row ? [{ checksum: row.checksum }] : [] };
    }
    if (sql.startsWith("SELECT version, checksum")) {
      return {
        rows: [...this.migrations.entries()].map(([version, row]) => ({
          version,
          checksum: row.checksum,
        })),
      };
    }
    if (sql.startsWith("INSERT INTO public.banglakhata_schema_migrations")) {
      this.migrations.set(params[0], { checksum: params[2] });
      return { rows: [] };
    }
    this.executedSql.push(sql);
    if (sql.includes("FAIL_MIGRATION")) throw new Error("simulated migration failure");
    return { rows: [] };
  }
}

async function withMigrations(files, callback) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "khata-migrations-"));
  try {
    for (const [name, sql] of Object.entries(files)) {
      await writeFile(path.join(directory, name), sql, "utf8");
    }
    await callback(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

test("loads SQL migrations in filename order with checksums", async () => {
  await withMigrations(
    {
      "20261010_000001_second.sql": "SELECT 2;",
      "20261009_000001_first.sql": "SELECT 1;",
    },
    async (directory) => {
      const migrations = await loadMigrations(directory);
      assert.deepEqual(migrations.map(({ name }) => name), ["first", "second"]);
      assert.ok(migrations.every(({ checksum }) => /^[a-f0-9]{64}$/.test(checksum)));
    },
  );
});

test("rejects transaction statements inside a migration file", async () => {
  await withMigrations(
    { "20261009_000001_wrapped.sql": "BEGIN;\nSELECT 1;\nCOMMIT;" },
    async (directory) => {
      await assert.rejects(loadMigrations(directory), /must not manage its own transaction/);
    },
  );
});

test("applies pending migrations once and tracks them transactionally", async () => {
  await withMigrations(
    {
      "20261009_000001_first.sql": "SELECT 1;",
      "20261010_000001_second.sql": "SELECT 2;",
    },
    async (directory) => {
      const client = new MockPgClient();
      const logger = { info() {} };
      assert.equal(await migrateSupabaseMigrations(client, directory, logger), 2);
      assert.equal(client.migrations.size, 2);
      assert.deepEqual(client.executedSql, ["SELECT 1;", "SELECT 2;"]);
      assert.equal(client.transactionOpen, false);
      assert.equal(await migrateSupabaseMigrations(client, directory, logger), 0);
      assert.equal(client.executedSql.length, 2);
    },
  );
});

test("rolls back a failed SQL migration and does not mark it applied", async () => {
  await withMigrations(
    { "20261009_000001_failing.sql": "FAIL_MIGRATION;" },
    async (directory) => {
      const client = new MockPgClient();
      await assert.rejects(
        migrateSupabaseMigrations(client, directory, { info() {} }),
        /simulated migration failure/,
      );
      assert.equal(client.rolledBack, 1);
      assert.equal(client.migrations.size, 0);
    },
  );
});

test("rejects edits to an already applied migration", async () => {
  await withMigrations(
    { "20261009_000001_first.sql": "SELECT 1;" },
    async (directory) => {
      const client = new MockPgClient();
      client.migrations.set("20261009_000001", { checksum: "different" });
      await assert.rejects(
        migrateSupabaseMigrations(client, directory, { info() {} }),
        /was edited/,
      );
    },
  );
});

test("rejects a recorded migration that was removed from the migration directory", async () => {
  await withMigrations({}, async (directory) => {
    const client = new MockPgClient();
    client.migrations.set("20261009_000001", { checksum: "known" });
    await assert.rejects(
      migrateSupabaseMigrations(client, directory, { info() {} }),
      /is missing from supabase\/migrations/,
    );
  });
});
