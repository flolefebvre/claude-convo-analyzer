import { existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaClient } from "@/core/prisma/generated/client";

/**
 * The database the app, `refresh()`, and the reads use when given no path:
 * `CCA_DB_PATH` (empty counts as unset) resolved against the process cwd, else
 * `~/.claude-convo-analyzer/analyzer.db`, beside the settings file. Read at call
 * time, so the env is honoured whenever it was set before the call.
 *
 * @example
 * // CCA_DB_PATH=data/seed/seed.db → "<cwd>/data/seed/seed.db"
 * const dbPath = defaultDbPath();
 */
export function defaultDbPath(): string {
  return path.resolve(
    /*turbopackIgnore: true*/ process.env.CCA_DB_PATH ||
      path.join(os.homedir(), ".claude-convo-analyzer", "analyzer.db"),
  );
}

/**
 * On-disk location of the committed Prisma migrations.
 *
 * Resolved cwd-relative (NOT via `import.meta.dirname`, the module's own
 * location): Turbopack sets `import.meta.dirname` to `undefined` in the Next.js
 * server bundle, so a module-relative resolve throws `ERR_INVALID_ARG_TYPE` at
 * load and crashes the server render. cwd-relative is bundler-safe. Unlike
 * {@link defaultDbPath}, it names the repo's code, not the user's data.
 */
const MIGRATIONS_DIR = path.join(process.cwd(), "src", "core", "prisma", "migrations");

/** The resolved migrations directory. Exposed as a testable seam so the
 * cwd-relative resolution above stays correct (see `migrations-dir.test.ts`). */
export function migrationsDir(): string {
  return MIGRATIONS_DIR;
}

/** Tracker table: which committed migrations have been applied to this DB. */
const MIGRATION_LEDGER = "_cca_migrations";

/** How long an opener waits for another connection's write lock before failing. */
const MIGRATION_LOCK_TIMEOUT_MS = 5000;

/** Pause between two attempts at the WAL switch while another opener holds the file. */
const WAL_SWITCH_RETRY_INTERVAL_MS = 10;

/**
 * Put `db`'s file in WAL mode, retrying while another connection holds it.
 * Switching a fresh rollback-journal file to WAL needs an exclusive lock, and
 * two openers both hold SHARED from the pragma's own read: SQLite skips the busy
 * handler on that upgrade to avoid deadlock, so the connection's `timeout`
 * cannot cover it, and a journal-mode change cannot sit inside a transaction.
 * Only `SQLITE_BUSY` is retried, up to {@link MIGRATION_LOCK_TIMEOUT_MS}.
 */
function switchToWalWaitingOnOtherOpeners(db: Database.Database): void {
  const deadline = Date.now() + MIGRATION_LOCK_TIMEOUT_MS;
  const sleepSignal = new Int32Array(new SharedArrayBuffer(4));
  for (;;) {
    try {
      db.pragma("journal_mode = WAL");
      return;
    } catch (error) {
      const isLockContention = (error as { code?: unknown }).code === "SQLITE_BUSY";
      if (!isLockContention || Date.now() >= deadline) throw error;
      Atomics.wait(sleepSignal, 0, 0, WAL_SWITCH_RETRY_INTERVAL_MS);
    }
  }
}

/**
 * Apply every committed migration's `migration.sql` to the database at `dbPath`,
 * in lexicographic (timestamp) order, idempotently and EXACTLY ONCE each. Used
 * to bring a sqlite file up to the current schema — notably for per-test temp
 * databases, where running the Prisma CLI would be too slow.
 *
 * Applied migrations are recorded by name in a small `_cca_migrations` ledger
 * (mirroring Prisma's `_prisma_migrations` semantics). On every open we apply
 * only the migrations NOT yet in the ledger, each with its ledger insert — so a
 * pre-existing DB still picks up a newly added migration (no schema drift on
 * upgrade) and re-opening is a no-op.
 *
 * Safe for concurrent openers: the ledger is first read without a lock, and an
 * up-to-date database returns there, taking no write lock. Otherwise the whole
 * catch-up runs in one `BEGIN IMMEDIATE` transaction that re-reads the ledger
 * first, so a second opener waits on the write lock (up to
 * {@link MIGRATION_LOCK_TIMEOUT_MS}) and then finds nothing left to apply. Being
 * one transaction, a failing migration rolls back the ones applied before it
 * in the same open too, and they are re-applied on every open until it is fixed.
 */
function applyMigrations(dbPath: string): void {
  const dir = path.dirname(dbPath);
  if (dir && !existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  const db = new Database(dbPath, { timeout: MIGRATION_LOCK_TIMEOUT_MS });
  try {
    // WAL belongs to the database FILE, so setting it on this first connection
    // puts every later one in WAL too: readers then run beside the one writer
    // instead of hitting SQLITE_BUSY while it commits.
    switchToWalWaitingOnOtherOpeners(db);
    // Commits skip the fsync per transaction: a power cut may lose the last
    // ones, acceptable since the database is a cache rebuildable from the logs.
    db.pragma("synchronous = NORMAL");
    db.exec(
      `CREATE TABLE IF NOT EXISTS "${MIGRATION_LEDGER}" (
         "migration_name" TEXT NOT NULL PRIMARY KEY,
         "applied_at" BIGINT NOT NULL
       )`,
    );

    const selectAppliedNames = db.prepare(`SELECT migration_name FROM "${MIGRATION_LEDGER}"`).pluck();
    const committedNames = readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && existsSync(path.join(MIGRATIONS_DIR, entry.name, "migration.sql")))
      .map((entry) => entry.name)
      .sort();
    const missingNames = () => {
      const appliedNames = new Set(selectAppliedNames.all() as string[]);
      return committedNames.filter((name) => !appliedNames.has(name));
    };

    if (missingNames().length === 0) return;

    const insertLedger = db.prepare(`INSERT INTO "${MIGRATION_LEDGER}" (migration_name, applied_at) VALUES (?, ?)`);
    // Each migration lands with its ledger row, in the same transaction: a
    // half-applied migration is never recorded as done.
    const applyMissing = db.transaction(() => {
      for (const name of missingNames()) {
        db.exec(readFileSync(path.join(MIGRATIONS_DIR, name, "migration.sql"), "utf8"));
        insertLedger.run(name, Date.now());
      }
    });
    applyMissing.immediate();
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
