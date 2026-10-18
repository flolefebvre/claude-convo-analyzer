import { existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaClient } from "@/core/prisma/generated/client";

/**
 * The database the app, `refresh()`, and the reads use when given no path:
 * `CCA_DB_PATH` (empty counts as unset) resolved against the process cwd, else
 * `./data/analyzer.db` (gitignored). Read at call time, so the env is honoured
 * whenever it was set before the call.
 *
 * @example
 * // CCA_DB_PATH=data/seed/seed.db → "<cwd>/data/seed/seed.db"
 * const dbPath = defaultDbPath();
 */
export function defaultDbPath(): string {
  return path.resolve(/*turbopackIgnore: true*/ process.env.CCA_DB_PATH || path.join("data", "analyzer.db"));
}

/**
 * On-disk location of the committed Prisma migrations.
 *
 * Resolved cwd-relative (NOT via `import.meta.dirname`, the module's own
 * location): Turbopack sets `import.meta.dirname` to `undefined` in the Next.js
 * server bundle, so a module-relative resolve throws `ERR_INVALID_ARG_TYPE` at
 * load and crashes the server render. cwd-relative is bundler-safe and stays
 * consistent with {@link defaultDbPath} above.
 */
const MIGRATIONS_DIR = path.join(process.cwd(), "src", "core", "prisma", "migrations");

/** The resolved migrations directory. Exposed as a testable seam so the
 * cwd-relative resolution above stays correct (see `migrations-dir.test.ts`). */
export function migrationsDir(): string {
  return MIGRATIONS_DIR;
}

/** Tracker table: which committed migrations have been applied to this DB. */
const MIGRATION_LEDGER = "_cca_migrations";

/**
 * Apply every committed migration's `migration.sql` to the database at `dbPath`,
 * in lexicographic (timestamp) order, idempotently and EXACTLY ONCE each. Used
 * to bring a sqlite file up to the current schema — notably for per-test temp
 * databases, where running the Prisma CLI would be too slow.
 *
 * Applied migrations are recorded by name in a small `_cca_migrations` ledger
 * (mirroring Prisma's `_prisma_migrations` semantics). On every open we apply
 * only the migrations NOT yet in the ledger, each in its own transaction with
 * its ledger insert — so a pre-existing DB still picks up a newly added
 * migration (no schema drift on upgrade) and re-opening is a no-op. The previous
 * "short-circuit if the `project` table exists" guard is gone: it would have
 * silently skipped any migration added after the initial one.
 */
function applyMigrations(dbPath: string): void {
  const dir = path.dirname(dbPath);
  if (dir && !existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  const db = new Database(dbPath);
  try {
    // WAL belongs to the database FILE, so setting it on this first connection
    // puts every later one in WAL too: readers then run beside the one writer
    // instead of hitting SQLITE_BUSY while it commits.
    db.pragma("journal_mode = WAL");
    // Commits skip the fsync per transaction: a power cut may lose the last
    // ones, acceptable since the database is a cache rebuildable from the logs.
    db.pragma("synchronous = NORMAL");
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
      // Each migration + its ledger row land atomically: a half-applied
      // migration must never be recorded as done.
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

/**
 * Build a fresh Prisma client bound to the sqlite file at `dbPath` via the
 * better-sqlite3 driver adapter. The schema is ensured (migrations applied) on
 * first creation for that file. Callers that need an isolated database (tests,
 * later `refresh({ dbPath })`) use this directly rather than the singleton.
 */
export function createPrismaClient(dbPath: string = defaultDbPath()): PrismaClient {
  applyMigrations(dbPath);
  const adapter = new PrismaBetterSqlite3({ url: `file:${dbPath}` });
  return new PrismaClient({ adapter });
}

/**
 * Open the bare better-sqlite3 connection a Refresh writes through (ADR-0005),
 * on the database at `dbPath`, its migrations applied first. Prisma stays the
 * owner of the schema and of every read; the caller closes this connection.
 *
 * @example
 * const db = openRefreshConnection(dbPath);
 * try { prepareRefreshStatements(db).selectStoredConversations(); } finally { db.close(); }
 */
export function openRefreshConnection(dbPath: string = defaultDbPath()): Database.Database {
  applyMigrations(dbPath);
  const db = new Database(dbPath);
  // Set explicitly, per connection: replacing a Conversation deletes its row,
  // and the cascades are what remove its child rows and fire the search index's
  // delete triggers. Without them the child rows would be orphaned.
  db.pragma("foreign_keys = ON");
  // Commits skip their fsync: a power cut may lose the last ones, acceptable
  // since the database is a cache rebuildable from the logs.
  db.pragma("synchronous = NORMAL");
  return db;
}

const globalForPrisma = globalThis as unknown as {
  __ccaPrisma?: PrismaClient;
};

/**
 * Process-wide singleton client for the {@link defaultDbPath} database. Guards
 * against duplicate clients under dev hot-reload by stashing the instance on
 * `globalThis`. It is bound to the path resolved on first use: changing
 * `CCA_DB_PATH` later in the same process does not rebind it. For other paths,
 * use {@link createPrismaClient}.
 *
 * @example
 * const conversations = await getPrismaClient().conversation.count();
 */
export function getPrismaClient(): PrismaClient {
  globalForPrisma.__ccaPrisma ??= createPrismaClient(defaultDbPath());
  return globalForPrisma.__ccaPrisma;
}

/**
 * Resolve the client a read should use. The default database ({@link defaultDbPath},
 * whether omitted or passed explicitly) goes through the
 * process-wide {@link getPrismaClient} singleton — reused across requests, so a
 * navigation never re-opens the sqlite file or re-checks migrations — and MUST
 * NOT be disconnected (`owned: false`). An explicit non-default `dbPath` (tests,
 * isolated DBs) gets a throwaway client the caller disconnects (`owned: true`).
 */
export function readClient(dbPath?: string): {
  prisma: PrismaClient;
  owned: boolean;
} {
  if (dbPath === undefined || dbPath === defaultDbPath()) {
    return { prisma: getPrismaClient(), owned: false };
  }
  return { prisma: createPrismaClient(dbPath), owned: true };
}
