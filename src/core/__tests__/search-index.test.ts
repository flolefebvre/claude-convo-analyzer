import { cpSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { refresh } from "@/core/refresh";

import { dropSearchIndex } from "./helpers/search-index";
import { applyPendingMigrations, seededTempDb } from "./helpers/temp-db";

const FIXTURES_ROOT = path.join(import.meta.dirname, "fixtures", "logs");

function open(dbPath: string): Database.Database {
  return new Database(dbPath);
}

function indexedMessageIds(db: Database.Database): Set<number> {
  db.exec("CREATE VIRTUAL TABLE IF NOT EXISTS temp.msg_vocab USING fts5vocab(main, message_fts, instance)");
  const rows = db.prepare("SELECT DISTINCT doc AS id FROM temp.msg_vocab").all() as { id: number }[];
  return new Set(rows.map((r) => r.id));
}

function indexedTitleIds(db: Database.Database): Set<number> {
  db.exec(
    "CREATE VIRTUAL TABLE IF NOT EXISTS temp.title_vocab USING fts5vocab(main, conversation_title_fts, instance)",
  );
  const rows = db.prepare("SELECT DISTINCT doc AS id FROM temp.title_vocab").all() as { id: number }[];
  return new Set(rows.map((r) => r.id));
}

function expectedCorpusIds(db: Database.Database): Set<number> {
  const rows = db
    .prepare(
      `SELECT id FROM message
        WHERE text IS NOT NULL AND (role = 'assistant' OR kind = 'prompt')`,
    )
    .all() as { id: number }[];
  return new Set(rows.map((r) => r.id));
}

function expectIndexMatchesCorpus(dbPath: string): void {
  const db = open(dbPath);
  try {
    expect([...indexedMessageIds(db)].sort((a, b) => a - b)).toEqual([...expectedCorpusIds(db)].sort((a, b) => a - b));
    const titles = db.prepare("SELECT id FROM conversation WHERE title IS NOT NULL").all() as { id: number }[];
    expect([...indexedTitleIds(db)].sort((a, b) => a - b)).toEqual(titles.map((t) => t.id).sort((a, b) => a - b));
  } finally {
    db.close();
  }
}

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
  const db = seededTempDb({ prefix: "cca-fts-", logsRoot: FIXTURES_ROOT });

  it("indexes human prompts", () => {
    expect(matchingUuids(db.dbPath, "transcript")).toContain("tu1");
  });

  it("indexes assistant message text", () => {
    expect(matchingUuids(db.dbPath, "running")).toContain("ta1");
  });

  it("indexes conversation titles", () => {
    expect(matchingTitleSessions(db.dbPath, "kinds")).toContain("sess-transcript");
  });

  it("never indexes meta records", () => {
    expect(matchingUuids(db.dbPath, "skill")).not.toContain("tu3");
    expect(matchingUuids(db.dbPath, "directory")).toHaveLength(0);
  });

  it("never indexes tool-result carrier messages", () => {
    expect(matchingUuids(db.dbPath, "done")).not.toContain("tu2");
  });

  it("never indexes tool inputs or tool results", () => {
    expect(matchingUuids(db.dbPath, "finish")).toHaveLength(0);
  });

  it("covers exactly the corpus after a first refresh", () => {
    expectIndexMatchesCorpus(db.dbPath);
  });
});

describe("FTS search index — consistency through refresh()", () => {
  let tmpDir: string;
  let logsRoot: string;
  let dbPath: string;
  let sessionPath: string;

  beforeEach(async () => {
    tmpDir = mkdtempSync(path.join(tmpdir(), "cca-fts-refresh-"));
    logsRoot = path.join(tmpDir, "logs");
    cpSync(FIXTURES_ROOT, logsRoot, { recursive: true });
    dbPath = path.join(tmpDir, "analyzer.db");
    sessionPath = path.join(logsRoot, "-Users-me-dev-transcript", "sess-transcript.jsonl");
    await refresh({ logsRoot, dbPath });
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

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

    expect(matchingUuids(dbPath, "kick")).not.toContain("tu1");
    expect(matchingUuids(dbPath, "flaky")).toContain("tu1");
    expect(matchingTitleSessions(dbPath, "kinds")).toHaveLength(0);
    expect(matchingTitleSessions(dbPath, "retitled")).toContain("sess-transcript");
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
    const db = open(dbPath);
    db.prepare("UPDATE conversation SET parser_version = 0").run();
    db.close();

    const summary = await refresh({ logsRoot, dbPath });
    expect(summary.conversationsParsed).toBeGreaterThanOrEqual(1);
    expect(summary.conversationsSkipped).toBe(0);

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
  const db = seededTempDb({
    prefix: "cca-fts-backfill-",
    logsRoot: FIXTURES_ROOT,
  });

  it("indexes conversations that were already in the database, with no re-parse", async () => {
    const dbPath = db.dbPath;

    const raw = open(dbPath);
    dropSearchIndex(raw);
    raw.close();

    await applyPendingMigrations(dbPath);

    expect(matchingUuids(dbPath, "transcript")).toContain("tu1");
    expect(matchingTitleSessions(dbPath, "kinds")).toContain("sess-transcript");
    expectIndexMatchesCorpus(dbPath);

    const summary = await refresh({ logsRoot: FIXTURES_ROOT, dbPath });
    expect(summary.conversationsParsed).toBe(0);
    expect(summary.conversationsSkipped).toBeGreaterThanOrEqual(1);
  });
});
