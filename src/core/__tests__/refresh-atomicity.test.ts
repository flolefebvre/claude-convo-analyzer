// A re-parsed Conversation is replaced atomically: a reader on another
// connection sees either its old version or its new one, never neither — so a
// Transcript page read while a Refresh writes never 404s on it.

import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { listConversations } from "@/core/read";
import { refresh } from "@/core/refresh";

/**
 * A reader probe on a second connection. When `sessionId` is armed, the moment
 * a Refresh transaction is about to insert its next Conversation row — after
 * any delete of its prior row in the same transaction, before the insert — the
 * probe reads that Conversation's rows through a connection of its own (not the
 * writer's), records what it saw, then disarms.
 */
const probe = vi.hoisted(() => ({
  sessionId: null as string | null,
  dbPath: "",
  titlesSeen: null as (string | null)[] | null,
}));

/** Run the armed probe, if any, then disarm it. */
function runArmedProbe(): void {
  if (probe.sessionId === null) return;
  probe.titlesSeen = readTitlesOnSecondConnection(probe.dbPath, probe.sessionId);
  probe.sessionId = null;
}

/** Read a Conversation's rows the way a concurrent reader would. */
function readTitlesOnSecondConnection(dbPath: string, sessionId: string): (string | null)[] {
  const db = new Database(dbPath, { readonly: true });
  try {
    const rows = db.prepare("SELECT title FROM conversation WHERE session_id = ?").all(sessionId) as {
      title: string | null;
    }[];
    return rows.map((r) => r.title);
  } finally {
    db.close();
  }
}

// The Refresh connection, with the probe run before each Conversation insert.
vi.mock("@/core/db", async (importOriginal) => {
  const db = await importOriginal<typeof import("@/core/db")>();
  const { hookStatements } = await import("./helpers/refresh-connection");
  return {
    ...db,
    openRefreshConnection: (dbPath?: string) =>
      hookStatements(
        db.openRefreshConnection(dbPath),
        (sql) => sql.startsWith('INSERT INTO "conversation"'),
        runArmedProbe,
      ),
  };
});

const FIXTURES_ROOT = path.join(import.meta.dirname, "fixtures", "logs");

describe("refresh atomicity", () => {
  let tmpDir: string;
  let logsRoot: string;
  let dbPath: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(path.join(tmpdir(), "cca-atomic-"));
    logsRoot = path.join(tmpDir, "logs");
    dbPath = path.join(tmpDir, "analyzer.db");
    cpSync(FIXTURES_ROOT, logsRoot, { recursive: true });
  });

  afterEach(() => {
    probe.sessionId = null;
    probe.titlesSeen = null;
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("never leaves a re-parsed conversation missing for a reader on another connection", async () => {
    await refresh({ logsRoot, dbPath });

    // Retitle sess-basic: a size change, so the next run re-parses it.
    const basicPath = path.join(logsRoot, "-Users-me-dev-demo", "sess-basic.jsonl");
    writeFileSync(
      basicPath,
      readFileSync(basicPath, "utf8").replace(
        '"aiTitle":"Refactor the parser"',
        '"aiTitle":"Refactor the parser, again"',
      ),
    );

    probe.dbPath = dbPath;
    probe.sessionId = "sess-basic";
    const summary = await refresh({ logsRoot, dbPath });

    expect(summary.conversationsParsed).toBe(1);
    // The probe really ran, mid-transaction, and saw the OLD version — present.
    expect(probe.sessionId).toBeNull();
    expect(probe.titlesSeen).toEqual(["Refactor the parser"]);

    // Afterwards: exactly one row, with the new content.
    expect(readTitlesOnSecondConnection(dbPath, "sess-basic")).toEqual(["Refactor the parser, again"]);
    const basic = (await listConversations({ dbPath })).filter((c) => c.id === "sess-basic");
    expect(basic.map((c) => c.title)).toEqual(["Refactor the parser, again"]);
  });
});
