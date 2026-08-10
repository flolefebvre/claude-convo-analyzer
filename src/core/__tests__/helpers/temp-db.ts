// Shared test setup around the test database: a throwaway SQLite file, seeded
// by the real `refresh()` from a fixture logs root, created fresh for each test
// and removed afterwards. Every core read test needs the same ~10 lines (issue
// #44), so they live here once — as does re-opening a database to apply the
// migrations a schema-rewinding test took out.
//
// Not a test file: it is excluded from vitest's `include` (see
// `vitest.config.ts`) because it declares no tests of its own.

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach } from "vitest";

import { createPrismaClient } from "@/core/db";
import { refresh } from "@/core/refresh";

/** Handle onto the current test's database; `dbPath` is valid inside a test. */
export type TempDb = {
  /** Path of the temp SQLite file seeded for the running test. */
  readonly dbPath: string;
};

/**
 * Register a per-test temp database seeded from `logsRoot` by the genuine
 * `refresh()` — so tests read exactly what the parser writes, never hand-poked
 * rows. Call at `describe` scope; the returned handle's `dbPath` resolves to the
 * database of the currently running test.
 */
export function seededTempDb(opts: {
  /** `mkdtemp` prefix, so a leaked directory names its owner (e.g. `cca-tools-`). */
  prefix: string;
  /** Fixture logs root to parse into the database. */
  logsRoot: string;
}): TempDb {
  let tmpDir = "";
  let dbPath = "";

  beforeEach(async () => {
    tmpDir = mkdtempSync(path.join(tmpdir(), opts.prefix));
    dbPath = path.join(tmpDir, "analyzer.db");
    await refresh({ logsRoot: opts.logsRoot, dbPath });
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  return {
    get dbPath() {
      return dbPath;
    },
  };
}

/**
 * Open and close the database at `dbPath`, so every migration missing from its
 * `_cca_migrations` ledger is applied — how a test that rewound the schema gets
 * it back, and how a migration's backfill is exercised.
 *
 * @example await applyPendingMigrations(db.dbPath);
 */
export async function applyPendingMigrations(dbPath: string): Promise<void> {
  const prisma = createPrismaClient(dbPath);
  await prisma.$disconnect();
}
