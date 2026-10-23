import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Worker } from "node:worker_threads";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createPrismaClient, migrationsDir, openRefreshConnection } from "@/core/db";

/** Every committed migration directory (timestamp-prefixed, sorted). */
function committedMigrations(): string[] {
  return readdirSync(migrationsDir(), { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort();
}

/** Every migration the ledger of the database at `dbPath` records as applied, one entry per row, sorted. */
function recordedMigrations(dbPath: string): string[] {
  const db = new Database(dbPath);
  try {
    return db.prepare("SELECT migration_name FROM _cca_migrations ORDER BY migration_name").pluck().all() as string[];
  } finally {
    db.close();
  }
}

// The worker's `.ts` graph uses the `@/` aliases, so it loads through tsx.
const TSX_EXEC_ARGV = ["--import", "tsx"];
const WORKER_TIMEOUT_MS = 30_000;

type OpenOutcome = { kind: "opened" } | { kind: "failed"; message: string };

/** Open `dbPath` from `workerCount` worker threads released at the same instant; each worker's outcome. */
async function openFromRacingWorkers(dbPath: string, workerCount: number): Promise<OpenOutcome[]> {
  const startSignal = new Int32Array(new SharedArrayBuffer(4));
  const readies: Promise<void>[] = [];
  const outcomes: Promise<OpenOutcome>[] = [];
  const workers = Array.from({ length: workerCount }, () => {
    const worker = new Worker(new URL("./helpers/open-refresh-connection.worker.ts", import.meta.url), {
      execArgv: TSX_EXEC_ARGV,
      workerData: { dbPath, startSignal },
    });
    readies.push(new Promise((resolve) => worker.once("message", () => resolve())));
    outcomes.push(
      new Promise((resolve, reject) => {
        worker.on("message", (message: { kind: "ready" } | OpenOutcome) => {
          if (message.kind !== "ready") resolve(message);
        });
        worker.on("error", reject);
      }),
    );
    return worker;
  });
  try {
    await Promise.all(readies);
    Atomics.store(startSignal, 0, 1);
    Atomics.notify(startSignal, 0);
    return await Promise.all(outcomes);
  } finally {
    await Promise.all(workers.map((worker) => worker.terminate()));
  }
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

    expect(recordedMigrations(dbPath)).toEqual(committedMigrations());
  });

  it(
    "two connections opening the same fresh database at once both succeed, each migration applied once",
    async () => {
      const outcomes = await openFromRacingWorkers(dbPath, 2);
      expect(outcomes).toEqual([{ kind: "opened" }, { kind: "opened" }]);
      expect(recordedMigrations(dbPath)).toEqual(committedMigrations());
    },
    WORKER_TIMEOUT_MS,
  );

  it("a migration that fails for its own reason throws at open and is not recorded", () => {
    const firstMigration = committedMigrations()[0];
    // A table the first migration creates, already there with another shape:
    // its `CREATE TABLE` fails, as a broken migration would.
    const db = new Database(dbPath);
    db.exec(`CREATE TABLE "conversation" ("unrelated" TEXT)`);
    db.close();

    expect(() => createPrismaClient(dbPath)).toThrow(/already exists/);

    expect(recordedMigrations(dbPath)).not.toContain(firstMigration);
  });

  it("opening an up-to-date DB takes no write lock: it succeeds while another connection holds one", async () => {
    const first = createPrismaClient(dbPath);
    await first.$disconnect();

    const writeLockHolder = new Database(dbPath);
    writeLockHolder.exec("BEGIN IMMEDIATE");
    try {
      // Waiting on the held lock would block for the whole lock timeout, then throw.
      openRefreshConnection(dbPath).close();
      await createPrismaClient(dbPath).$disconnect();
    } finally {
      writeLockHolder.exec("ROLLBACK");
      writeLockHolder.close();
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
      const count = db.prepare("SELECT COUNT(*) AS c FROM _cca_migrations").get() as { c: number };
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
      const applied = db.prepare("SELECT COUNT(*) AS c FROM _cca_migrations WHERE migration_name = ?").get(target) as {
        c: number;
      };
      expect(applied.c).toBe(1);
    } finally {
      db.close();
    }
  });

  it("drops the API requests Recordings fed, and keeps the logs' under the plain name, from a database that still holds both", async () => {
    const targets = committedMigrations().filter(
      (m) => m.endsWith("_drop_recorded_api_request") || m.endsWith("_api_request_from_logged_api_request"),
    );
    expect(targets).toHaveLength(2);
    createPrismaClient(dbPath);

    // A database from before both: the logs' table under its old name, with a
    // row, beside the table Recordings fed, with a row too.
    let db = new Database(dbPath);
    for (const target of targets) db.prepare("DELETE FROM _cca_migrations WHERE migration_name = ?").run(target);
    db.exec(`ALTER TABLE "api_request" RENAME TO "logged_api_request"`);
    // Its Turn link of then, which a later migration moved onto `message`.
    db.exec(`ALTER TABLE "logged_api_request" ADD COLUMN "message_id" INTEGER`);
    db.pragma("foreign_keys = OFF");
    db.exec(
      `INSERT INTO "logged_api_request" ("conversation_id", "agent_id", "record_id", "kept_message_count",
         "tail_message_hashes_json", "parameters_json", "cache_breakpoints_json", "position_in_file")
       VALUES (1, 1, 'req-1', 0, '[]', '{}', '[]', 0)`,
    );
    db.exec(`CREATE TABLE "api_request" ("id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT, "kind" TEXT NOT NULL)`);
    db.exec(`INSERT INTO "api_request" ("kind") VALUES ('session-naming')`);
    db.close();

    const prisma = createPrismaClient(dbPath);
    await prisma.$disconnect();

    db = new Database(dbPath);
    try {
      const tables = db
        .prepare(
          "SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('api_request', 'logged_api_request')",
        )
        .all();
      expect(tables).toEqual([{ name: "api_request" }]);
      expect(db.prepare(`SELECT "record_id" FROM "api_request"`).all()).toEqual([{ record_id: "req-1" }]);
    } finally {
      db.close();
    }
  });
});
