import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createPrismaClient, migrationsDir } from "@/core/db";

/** Every committed migration directory (timestamp-prefixed, sorted). */
function committedMigrations(): string[] {
  return readdirSync(migrationsDir(), { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort();
}

describe("migration idempotency", () => {
  let tmpDir: string;
  let dbPath: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(path.join(tmpdir(), "cca-migrate-"));
    dbPath = path.join(tmpDir, "analyzer.db");
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("records every committed migration as applied, exactly once", async () => {
    const prisma = createPrismaClient(dbPath);
    await prisma.$disconnect();

    const db = new Database(dbPath);
    try {
      const rows = db
        .prepare("SELECT migration_name FROM _cca_migrations ORDER BY migration_name")
        .all() as { migration_name: string }[];
      expect(rows.map((r) => r.migration_name)).toEqual(committedMigrations());
    } finally {
      db.close();
    }
  });

  it("re-opening an existing DB is a no-op (each migration runs at most once)", async () => {
    // First open applies all migrations.
    const first = createPrismaClient(dbPath);
    await first.$disconnect();

    // Second open must NOT re-run any migration (idempotent) and must succeed
    // even though every table already exists.
    const second = createPrismaClient(dbPath);
    try {
      const tables = await second.$queryRawUnsafe<{ name: string }[]>(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'conversation'",
      );
      expect(tables).toHaveLength(1);
    } finally {
      await second.$disconnect();
    }

    const db = new Database(dbPath);
    try {
      const count = db
        .prepare("SELECT COUNT(*) AS c FROM _cca_migrations")
        .get() as { c: number };
      expect(count.c).toBe(committedMigrations().length);
    } finally {
      db.close();
    }
  });

  it("applies a later migration to a DB stuck at an older migration state", async () => {
    const all = committedMigrations();
    expect(all.length).toBeGreaterThanOrEqual(2);
    // Target the migration that adds `agent.external_agent_id` — re-applying it
    // has a directly observable effect (the column reappears).
    const target = all.find((m) => m.endsWith("_agent_external_id"));
    expect(target).toBeDefined();
    if (target === undefined) return;

    createPrismaClient(dbPath); // builds the schema + ledger

    // Simulate an OLD DB that never got `target`: forget its ledger row AND drop
    // the column it adds, then re-open to prove the migration is (re)applied.
    let db = new Database(dbPath);
    db.prepare("DELETE FROM _cca_migrations WHERE migration_name = ?").run(target);
    db.exec("ALTER TABLE agent DROP COLUMN external_agent_id");
    db.close();

    // Re-open: the tracker sees `target` as unapplied and runs it again.
    const prisma = createPrismaClient(dbPath);
    await prisma.$disconnect();

    db = new Database(dbPath);
    try {
      const cols = db.prepare("PRAGMA table_info(agent)").all() as {
        name: string;
      }[];
      expect(cols.some((c) => c.name === "external_agent_id")).toBe(true);
      const applied = db
        .prepare("SELECT COUNT(*) AS c FROM _cca_migrations WHERE migration_name = ?")
        .get(target) as { c: number };
      expect(applied.c).toBe(1);
    } finally {
      db.close();
    }
  });
});
