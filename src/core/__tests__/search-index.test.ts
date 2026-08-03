// The FTS5 search index (issue #45) — the corpus it covers and its consistency
// through `refresh()`.
//
// The index is maintained by SQLite triggers created in a raw-SQL migration
// (Prisma cannot model virtual tables), so these tests drive the genuine
// `refresh()` and then inspect the index itself with better-sqlite3 — the same
// raw-inspection style as `migrations.test.ts`.
//
// HOW THE INDEX IS INSPECTED: `message_fts` is an EXTERNAL-CONTENT table, so a
// plain `SELECT rowid FROM message_fts` scans the *content* table (`message`)
// and would happily report rows the index never covered. `fts5vocab` reads the
// index and nothing else, so `indexedMessageIds()` is exact evidence of what is
// really indexed — which is what "the index stays consistent" has to mean.

import { cpSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createPrismaClient } from "@/core/db";
import { refresh } from "@/core/refresh";

import { dropSearchIndex } from "./helpers/search-index";

const FIXTURES_ROOT = path.join(import.meta.dirname, "fixtures", "logs");

/** Open the database for raw inspection (the index is not a Prisma model). */
function open(dbPath: string): Database.Database {
  return new Database(dbPath);
}

/**
 * The `message` row ids the FTS index actually holds, read from the index via
 * `fts5vocab` (never through the external content table).
 */
function indexedMessageIds(db: Database.Database): Set<number> {
  db.exec(
    "CREATE VIRTUAL TABLE IF NOT EXISTS temp.msg_vocab USING fts5vocab(main, message_fts, instance)",
  );
  const rows = db
    .prepare("SELECT DISTINCT doc AS id FROM temp.msg_vocab")
    .all() as { id: number }[];
  return new Set(rows.map((r) => r.id));
}

/** The `conversation` row ids the title index holds (same vocab technique). */
function indexedTitleIds(db: Database.Database): Set<number> {
  db.exec(
    "CREATE VIRTUAL TABLE IF NOT EXISTS temp.title_vocab USING fts5vocab(main, conversation_title_fts, instance)",
  );
  const rows = db
    .prepare("SELECT DISTINCT doc AS id FROM temp.title_vocab")
    .all() as { id: number }[];
  return new Set(rows.map((r) => r.id));
}

/**
 * The corpus as the SPEC defines it, computed straight from the `message`
 * table: human prompts and assistant text — never meta records, tool-result
 * carriers, or text-less rows. The index must equal this set, always.
 */
function expectedCorpusIds(db: Database.Database): Set<number> {
  const rows = db
    .prepare(
      `SELECT id FROM message
        WHERE text IS NOT NULL AND (role = 'assistant' OR kind = 'prompt')`,
    )
    .all() as { id: number }[];
  return new Set(rows.map((r) => r.id));
}

/** Assert the index covers exactly the corpus — no orphans, no gaps. */
function expectIndexMatchesCorpus(dbPath: string): void {
  const db = open(dbPath);
  try {
    expect([...indexedMessageIds(db)].sort((a, b) => a - b)).toEqual(
      [...expectedCorpusIds(db)].sort((a, b) => a - b),
    );
    const titles = db
      .prepare("SELECT id FROM conversation WHERE title IS NOT NULL")
      .all() as { id: number }[];
    expect([...indexedTitleIds(db)].sort((a, b) => a - b)).toEqual(
      titles.map((t) => t.id).sort((a, b) => a - b),
    );
  } finally {
    db.close();
  }
}

/** The message uuids matching an FTS query (the searchable corpus, observed). */
function matchingUuids(dbPath: string, query: string): string[] {
  const db = open(dbPath);
  try {
    const rows = db
      .prepare(
        `SELECT m.uuid AS uuid
           FROM message_fts f JOIN message m ON m.id = f.rowid
          WHERE message_fts MATCH ?
          ORDER BY m.uuid`,
      )
      .all(query) as { uuid: string | null }[];
    return rows.map((r) => r.uuid ?? "");
  } finally {
    db.close();
  }
}

/** The session ids whose TITLE matches an FTS query. */
function matchingTitleSessions(dbPath: string, query: string): string[] {
  const db = open(dbPath);
  try {
    const rows = db
      .prepare(
        `SELECT c.session_id AS s
           FROM conversation_title_fts f JOIN conversation c ON c.id = f.rowid
          WHERE conversation_title_fts MATCH ?
          ORDER BY c.session_id`,
      )
      .all(query) as { s: string }[];
    return rows.map((r) => r.s);
  } finally {
    db.close();
  }
}

describe("FTS search index — corpus", () => {
  let tmpDir: string;
  let dbPath: string;

  beforeEach(async () => {
    tmpDir = mkdtempSync(path.join(tmpdir(), "cca-fts-"));
    dbPath = path.join(tmpDir, "analyzer.db");
    await refresh({ logsRoot: FIXTURES_ROOT, dbPath });
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("indexes human prompts", () => {
    expect(matchingUuids(dbPath, "transcript")).toContain("tu1");
  });

  it("indexes assistant message text", () => {
    expect(matchingUuids(dbPath, "running")).toContain("ta1");
  });

  it("indexes conversation titles", () => {
    expect(matchingTitleSessions(dbPath, "kinds")).toContain("sess-transcript");
  });

  it("never indexes meta records", () => {
    // `tu3` is an isMeta skill-instruction record.
    expect(matchingUuids(dbPath, "skill")).not.toContain("tu3");
    expect(matchingUuids(dbPath, "directory")).toHaveLength(0);
  });

  it("never indexes tool-result carrier messages", () => {
    // `tu2` carries the Bash result "done".
    expect(matchingUuids(dbPath, "done")).not.toContain("tu2");
  });

  it("never indexes tool inputs or tool results", () => {
    // The Bash call's command/description live in tool_call, not the corpus.
    expect(matchingUuids(dbPath, "finish")).toHaveLength(0);
  });

  it("covers exactly the corpus after a first refresh", () => {
    expectIndexMatchesCorpus(dbPath);
  });
});

describe("FTS search index — consistency through refresh()", () => {
  let tmpDir: string;
  let logsRoot: string;
  let dbPath: string;
  let sessionPath: string;

  /** A private copy of the fixtures the test may rewrite/delete. */
  beforeEach(async () => {
    tmpDir = mkdtempSync(path.join(tmpdir(), "cca-fts-refresh-"));
    logsRoot = path.join(tmpDir, "logs");
    cpSync(FIXTURES_ROOT, logsRoot, { recursive: true });
    dbPath = path.join(tmpDir, "analyzer.db");
    sessionPath = path.join(
      logsRoot,
      "-Users-me-dev-transcript",
      "sess-transcript.jsonl",
    );
    await refresh({ logsRoot, dbPath });
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  /** Rewrite a session file's prompt text and make it look changed on disk. */
  function rewritePrompt(newText: string): void {
    const lines = [
      '{"type":"ai-title","aiTitle":"Retitled run"}',
      `{"type":"user","uuid":"tu1","timestamp":"2026-06-20T11:00:00.000Z","cwd":"/Users/me/dev/transcript","version":"2.1.180","isMeta":false,"message":{"role":"user","content":${JSON.stringify(newText)}}}`,
      "",
    ];
    writeFileSync(sessionPath, lines.join("\n"), "utf8");
    const future = new Date(Date.now() + 60_000);
    utimesSync(sessionPath, future, future);
  }

  it("re-indexes a changed conversation's rewritten text, dropping the old", async () => {
    expect(matchingUuids(dbPath, "transcript")).toContain("tu1");

    rewritePrompt("investigate the flaky migration");
    const summary = await refresh({ logsRoot, dbPath });
    expect(summary.conversationsParsed).toBeGreaterThanOrEqual(1);

    // The old wording is gone from the index; the new wording is in it.
    // (Other fixtures use the word too — what matters is that THIS message no
    // longer matches its previous text.)
    expect(matchingUuids(dbPath, "kick")).not.toContain("tu1");
    expect(matchingUuids(dbPath, "flaky")).toContain("tu1");
    // The old title went with it.
    expect(matchingTitleSessions(dbPath, "kinds")).toHaveLength(0);
    expect(matchingTitleSessions(dbPath, "retitled")).toContain(
      "sess-transcript",
    );
    expectIndexMatchesCorpus(dbPath);
  });

  it("drops a deleted conversation's rows from the index", async () => {
    rmSync(sessionPath);
    const summary = await refresh({ logsRoot, dbPath });
    expect(summary.conversationsDeleted).toBeGreaterThanOrEqual(1);

    expect(matchingUuids(dbPath, "transcript")).toHaveLength(0);
    expect(matchingTitleSessions(dbPath, "kinds")).toHaveLength(0);
    expectIndexMatchesCorpus(dbPath);
  });

  it("stays consistent (no duplicates) through a parser-version re-parse", async () => {
    // A parser upgrade: every stored row is stale, so the next refresh
    // re-parses conversations whose files never changed.
    const db = open(dbPath);
    db.prepare("UPDATE conversation SET parser_version = 0").run();
    db.close();

    const summary = await refresh({ logsRoot, dbPath });
    expect(summary.conversationsParsed).toBeGreaterThanOrEqual(1);
    expect(summary.conversationsSkipped).toBe(0);

    // One hit per matching message — a stale index would double them.
    expect(matchingUuids(dbPath, "transcript")).toEqual(["tu1"]);
    expectIndexMatchesCorpus(dbPath);
  });

  it("stays consistent when an unchanged conversation is skipped", async () => {
    const summary = await refresh({ logsRoot, dbPath });
    expect(summary.conversationsSkipped).toBeGreaterThanOrEqual(1);
    expect(matchingUuids(dbPath, "transcript")).toEqual(["tu1"]);
    expectIndexMatchesCorpus(dbPath);
  });
});

describe("FTS search index — backfill on upgrade", () => {
  let tmpDir: string;
  let dbPath: string;

  beforeEach(async () => {
    tmpDir = mkdtempSync(path.join(tmpdir(), "cca-fts-backfill-"));
    dbPath = path.join(tmpDir, "analyzer.db");
    await refresh({ logsRoot: FIXTURES_ROOT, dbPath });
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("indexes conversations that were already in the database, with no re-parse", async () => {
    // Simulate the pre-search database: drop the index + its ledger entry, as
    // if the migration had never run, then re-open (which re-applies it).
    const db = open(dbPath);
    dropSearchIndex(db);
    db.close();

    // Re-opening applies the migration — which must BACKFILL the existing rows.
    const prisma = createPrismaClient(dbPath);
    await prisma.$disconnect();

    expect(matchingUuids(dbPath, "transcript")).toContain("tu1");
    expect(matchingTitleSessions(dbPath, "kinds")).toContain("sess-transcript");
    expectIndexMatchesCorpus(dbPath);

    // And a following refresh has nothing to re-parse: the backfill made the
    // existing database searchable without paying for a re-parse.
    const summary = await refresh({ logsRoot: FIXTURES_ROOT, dbPath });
    expect(summary.conversationsParsed).toBe(0);
    expect(summary.conversationsSkipped).toBeGreaterThanOrEqual(1);
  });
});
