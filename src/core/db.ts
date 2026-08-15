import { existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaClient } from "@/core/prisma/generated/client";

export const DEFAULT_DB_PATH = path.join(process.cwd(), "data", "analyzer.db");

const MIGRATIONS_DIR = path.join(process.cwd(), "src", "core", "prisma", "migrations");

export function migrationsDir(): string {
  return MIGRATIONS_DIR;
}

const MIGRATION_LEDGER = "_cca_migrations";

function applyMigrations(dbPath: string): void {
  const dir = path.dirname(dbPath);
  if (dir && !existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  const db = new Database(dbPath);
  try {
    db.exec(
      `CREATE TABLE IF NOT EXISTS "${MIGRATION_LEDGER}" (
         "migration_name" TEXT NOT NULL PRIMARY KEY,
         "applied_at" BIGINT NOT NULL
       )`,
    );

    const applied = new Set(
      (db.prepare(`SELECT migration_name FROM "${MIGRATION_LEDGER}"`).all() as { migration_name: string }[]).map(
        (r) => r.migration_name,
      ),
    );

    const migrationDirs = readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();

    const insertLedger = db.prepare(`INSERT INTO "${MIGRATION_LEDGER}" (migration_name, applied_at) VALUES (?, ?)`);

    for (const name of migrationDirs) {
      if (applied.has(name)) continue;
      const sqlPath = path.join(MIGRATIONS_DIR, name, "migration.sql");
      if (!existsSync(sqlPath)) continue;
      const sql = readFileSync(sqlPath, "utf8");
      const run = db.transaction(() => {
        db.exec(sql);
        insertLedger.run(name, Date.now());
      });
      run();
    }
  } finally {
    db.close();
  }
}

export function createPrismaClient(dbPath: string = DEFAULT_DB_PATH): PrismaClient {
  applyMigrations(dbPath);
  const adapter = new PrismaBetterSqlite3({ url: `file:${dbPath}` });
  return new PrismaClient({ adapter });
}

const globalForPrisma = globalThis as unknown as {
  __ccaPrisma?: PrismaClient;
};

export function getPrismaClient(): PrismaClient {
  globalForPrisma.__ccaPrisma ??= createPrismaClient(DEFAULT_DB_PATH);
  return globalForPrisma.__ccaPrisma;
}

export function readClient(dbPath?: string): {
  prisma: PrismaClient;
  owned: boolean;
} {
  if (dbPath === undefined || dbPath === DEFAULT_DB_PATH) {
    return { prisma: getPrismaClient(), owned: false };
  }
  return { prisma: createPrismaClient(dbPath), owned: true };
}
