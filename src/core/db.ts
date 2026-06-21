import { existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaClient } from "@/core/prisma/generated/client";

/**
 * Default on-disk database location (`./data/analyzer.db`, gitignored).
 * Resolved against the process cwd so it is stable across the app and tests.
 */
export const DEFAULT_DB_PATH = path.join(process.cwd(), "data", "analyzer.db");

const MIGRATIONS_DIR = path.join(
  import.meta.dirname,
  "prisma",
  "migrations",
);

/**
 * Apply every committed migration's `migration.sql` to the database at `dbPath`,
 * in lexicographic (timestamp) order, idempotently. Used to bring a fresh
 * sqlite file up to the current schema — notably for per-test temp databases,
 * where running the Prisma CLI would be too slow.
 *
 * Migrations are applied inside a transaction; already-applied DDL is tracked
 * by Prisma's own `_prisma_migrations` table created by `prisma migrate deploy`,
 * but for the lightweight programmatic path we simply guard on table existence.
 */
function applyMigrations(dbPath: string): void {
  const dir = path.dirname(dbPath);
  if (dir && !existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  const db = new Database(dbPath);
  try {
    const alreadyInitialized = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'project'",
      )
      .get();
    if (alreadyInitialized) {
      return;
    }

    const migrationDirs = readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();

    for (const name of migrationDirs) {
      const sqlPath = path.join(MIGRATIONS_DIR, name, "migration.sql");
      if (!existsSync(sqlPath)) continue;
      db.exec(readFileSync(sqlPath, "utf8"));
    }
  } finally {
    db.close();
  }
}

/**
 * Build a fresh Prisma client bound to the sqlite file at `dbPath` via the
 * better-sqlite3 driver adapter. The schema is ensured (migrations applied) on
 * first creation for that file. Callers that need an isolated database (tests,
 * later `refresh({ dbPath })`) use this directly rather than the singleton.
 */
export function createPrismaClient(dbPath: string = DEFAULT_DB_PATH): PrismaClient {
  applyMigrations(dbPath);
  const adapter = new PrismaBetterSqlite3({ url: `file:${dbPath}` });
  return new PrismaClient({ adapter });
}

const globalForPrisma = globalThis as unknown as {
  __ccaPrisma?: PrismaClient;
};

/**
 * Process-wide singleton client for the default database. Guards against
 * duplicate clients under dev hot-reload by stashing the instance on
 * `globalThis`. For non-default paths, use {@link createPrismaClient}.
 */
export function getPrismaClient(): PrismaClient {
  globalForPrisma.__ccaPrisma ??= createPrismaClient(DEFAULT_DB_PATH);
  return globalForPrisma.__ccaPrisma;
}
