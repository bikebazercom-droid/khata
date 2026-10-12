import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

const migrationFilename = /^(\d{8}_\d{6})_([a-z0-9_]+)\.sql$/;
const lockNamespace = 741026;
const lockName = "banglakhata:supabase-schema-migrations";

export async function loadMigrations(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const sqlEntries = entries.filter((entry) => entry.isFile() && entry.name.endsWith(".sql"));
  const migrations = [];
  const seenVersions = new Set();

  for (const entry of sqlEntries) {
    const match = migrationFilename.exec(entry.name);
    if (!match) {
      throw new Error(`Invalid SQL migration filename: ${entry.name}`);
    }
    if (seenVersions.has(match[1])) {
      throw new Error(`Duplicate migration version: ${match[1]}`);
    }
    seenVersions.add(match[1]);

    const sql = await readFile(join(directory, entry.name), "utf8");
    if (!sql.trim()) {
      throw new Error(`SQL migration is empty: ${entry.name}`);
    }
    if (/^\s*(BEGIN|COMMIT|ROLLBACK)\s*;/im.test(sql)) {
      throw new Error(
        `Migration ${entry.name} must not manage its own transaction; the runner wraps each file transactionally.`,
      );
    }
    migrations.push({
      version: match[1],
      name: match[2],
      checksum: createHash("sha256").update(sql).digest("hex"),
      sql,
    });
  }

  return migrations.sort((a, b) => a.version.localeCompare(b.version));
}

export async function migrateSupabaseMigrations(client, directory, logger = console) {
  await client.query("SELECT pg_advisory_lock($1, hashtext($2))", [lockNamespace, lockName]);

  try {
    await client.query("BEGIN");
    await client.query(`
      CREATE TABLE IF NOT EXISTS public.banglakhata_schema_migrations (
        version text PRIMARY KEY,
        name text NOT NULL,
        checksum text NOT NULL,
        applied_at timestamptz NOT NULL DEFAULT now()
      )
    `);
    await client.query("COMMIT");

    const migrations = await loadMigrations(directory);
    const appliedResult = await client.query(
      "SELECT version, checksum FROM public.banglakhata_schema_migrations ORDER BY version",
    );
    const appliedByVersion = new Map(
      appliedResult.rows.map((row) => [row.version, row.checksum]),
    );
    const localVersions = new Set(migrations.map((migration) => migration.version));

    for (const version of appliedByVersion.keys()) {
      if (!localVersions.has(version)) {
        throw new Error(
          `Recorded migration ${version} is missing from supabase/migrations; restore it instead of deleting or renaming it.`,
        );
      }
    }

    let appliedCount = 0;

    for (const migration of migrations) {
      const appliedChecksum = appliedByVersion.get(migration.version);

      if (appliedChecksum) {
        if (appliedChecksum !== migration.checksum) {
          throw new Error(
            `Applied migration ${migration.version} was edited. Restore it and add a new migration instead.`,
          );
        }
        continue;
      }

      await client.query("BEGIN");
      try {
        await client.query(migration.sql);
        await client.query(
          `INSERT INTO public.banglakhata_schema_migrations (version, name, checksum)
           VALUES ($1, $2, $3)`,
          [migration.version, migration.name, migration.checksum],
        );
        await client.query("COMMIT");
        appliedCount += 1;
        logger.info(`Applied schema migration ${migration.version}_${migration.name}.`);
      } catch (error) {
        await client.query("ROLLBACK").catch(() => undefined);
        throw error;
      }
    }

    logger.info(
      appliedCount === 0
        ? "Database schema is up to date; no migrations were pending."
        : `Committed ${appliedCount} schema migration${appliedCount === 1 ? "" : "s"}.`,
    );
    return appliedCount;
  } finally {
    await client.query("SELECT pg_advisory_unlock($1, hashtext($2))", [lockNamespace, lockName]);
  }
}
