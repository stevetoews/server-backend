import { readdir, readFile } from "node:fs/promises";

import { getDbClient } from "./client.js";

const MIGRATIONS_DIR = new URL("../../migrations/", import.meta.url);

function splitSqlStatements(source: string): string[] {
  return source
    .split(/;\s*(?:\r?\n|$)/g)
    .map((statement) => statement.trim())
    .filter(Boolean);
}

async function ensureMigrationTable(): Promise<void> {
  const db = getDbClient();

  await db.execute(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL
    )
  `);
}

async function migrationAlreadyApplied(name: string): Promise<boolean> {
  const db = getDbClient();
  const result = await db.execute({
    sql: "SELECT name FROM schema_migrations WHERE name = ? LIMIT 1",
    args: [name],
  });

  return result.rows.length > 0;
}

async function markMigrationApplied(name: string): Promise<void> {
  const db = getDbClient();
  await db.execute({
    sql: "INSERT INTO schema_migrations (name, applied_at) VALUES (?, ?)",
    args: [name, new Date().toISOString()],
  });
}

async function getAppliedMigrationNames(): Promise<Set<string>> {
  const db = getDbClient();
  const result = await db.execute("SELECT name FROM schema_migrations");

  return new Set(
    result.rows
      .map((row) => row.name)
      .filter((name): name is string => typeof name === "string"),
  );
}

export async function runMigrations(): Promise<string[]> {
  await ensureMigrationTable();
  const db = getDbClient();

  // Backfill manually for migrations that might partially fail when rerun against an existing schema.
  const hasIncidentsCheckType = await db.execute(`
    PRAGMA table_info(incidents)
  `);
  const incidentColumns = new Set(
    hasIncidentsCheckType.rows
      .map((row) => row.name)
      .filter((name): name is string => typeof name === "string"),
  );

  if (incidentColumns.has("check_type") && !(await migrationAlreadyApplied("003_incident_check_type.sql"))) {
    await markMigrationApplied("003_incident_check_type.sql");
  }

  const files = (await readdir(MIGRATIONS_DIR))
    .filter((name) => name.endsWith(".sql"))
    .sort((left, right) => left.localeCompare(right));
  const applied = await getAppliedMigrationNames();
  const executed: string[] = [];

  for (const fileName of files) {
    if (applied.has(fileName)) {
      continue;
    }

    const sql = await readFile(new URL(fileName, MIGRATIONS_DIR), "utf8");
    const statements = splitSqlStatements(sql);

    for (const statement of statements) {
      await db.execute(statement);
    }

    await markMigrationApplied(fileName);

    executed.push(fileName);
  }

  return executed;
}

export async function verifySchemaReady(): Promise<boolean> {
  const db = getDbClient();
  const result = await db.execute(`
    SELECT name
    FROM sqlite_master
    WHERE type = 'table'
      AND name IN (
        'schema_migrations',
        'servers',
        'integrations',
        'audit_logs',
        'notification_targets',
        'notification_deliveries'
      )
  `);

  return result.rows.length === 6;
}
