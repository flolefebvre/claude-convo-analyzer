// A log file deleted after discovery saw it — a scratch session cleaned up, a
// worktree removed — is skipped, not fatal: the Refresh goes on and counts it.
// The deletion happens in the run's first progress report (`done: 0`), which
// comes after discovery and the compare, before the first file is read.

import { cpSync, mkdirSync, mkdtempSync, rmSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getConversation, listConversations } from "@/core/read";
import { refresh, type RefreshProgress } from "@/core/refresh";

const FIXTURES_ROOT = path.join(import.meta.dirname, "fixtures", "logs");

/** An `onProgress` that runs `action` once, on the run's first report. */
function beforeFirstRead(action: () => void): (progress: RefreshProgress) => void {
  let hasRun = false;
  return ({ done }) => {
    if (hasRun || done !== 0) return;
    hasRun = true;
    action();
  };
}

describe("a log file that vanished during the refresh", () => {
  let tmpDir: string;
  let logsRoot: string;
  let dbPath: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(path.join(tmpdir(), "cca-vanished-"));
    logsRoot = path.join(tmpDir, "logs");
    dbPath = path.join(tmpDir, "analyzer.db");
    cpSync(FIXTURES_ROOT, logsRoot, { recursive: true });
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  /** The session ids a cold Refresh of the untouched fixtures stores. */
  async function allSessionIds(): Promise<string[]> {
    const controlDbPath = path.join(tmpDir, "control.db");
    await refresh({ logsRoot: FIXTURES_ROOT, dbPath: controlDbPath });
    return (await listConversations({ dbPath: controlDbPath })).map((c) => c.id).sort();
  }

  it("skips a main transcript deleted before its read, writes every other Conversation, and counts it", async () => {
    const expectedSessionIds = (await allSessionIds()).filter((id) => id !== "sess-basic");
    const basicPath = path.join(logsRoot, "-Users-me-dev-demo", "sess-basic.jsonl");

    const summary = await refresh({ logsRoot, dbPath, onProgress: beforeFirstRead(() => rmSync(basicPath)) });

    expect(summary.vanishedLogFilesSkipped).toBe(1);
    expect(summary.conversationsParsed).toBe(expectedSessionIds.length);
    expect((await listConversations({ dbPath })).map((c) => c.id).sort()).toEqual(expectedSessionIds);
  });

  it("removes the stored Conversation of a changed main transcript deleted before its read", async () => {
    await refresh({ logsRoot, dbPath });
    const basicPath = path.join(logsRoot, "-Users-me-dev-demo", "sess-basic.jsonl");
    // A minute later: the change key differs, so the compare picks it to re-parse.
    const later = new Date(Date.now() + 60_000);
    utimesSync(basicPath, later, later);

    const summary = await refresh({ logsRoot, dbPath, onProgress: beforeFirstRead(() => rmSync(basicPath)) });

    expect(summary.conversationsParsed).toBe(0);
    expect(summary.conversationsDeleted).toBe(1);
    expect(summary.vanishedLogFilesSkipped).toBe(1);
    expect(await getConversation("sess-basic", { dbPath })).toBeNull();
    expect(await getConversation("sess-sub", { dbPath })).not.toBeNull();
  });

  it("writes the parent Conversation without a sub-agent transcript deleted before its read", async () => {
    const subAgentPath = path.join(logsRoot, "-Users-me-dev-sub", "sess-sub", "subagents", "agent-sub1.jsonl");

    const summary = await refresh({ logsRoot, dbPath, onProgress: beforeFirstRead(() => rmSync(subAgentPath)) });

    expect(summary.vanishedLogFilesSkipped).toBe(1);
    const parent = await getConversation("sess-sub", { dbPath });
    expect(parent).not.toBeNull();
    expect(parent?.subAgents).toEqual([]);
  });

  it("still fails the run when a log file cannot be read for another reason than being gone", async () => {
    const basicPath = path.join(logsRoot, "-Users-me-dev-demo", "sess-basic.jsonl");
    // A directory in its place: the read fails with EISDIR, not ENOENT.
    const replaceWithDirectory = () => {
      rmSync(basicPath);
      mkdirSync(basicPath);
    };

    await expect(refresh({ logsRoot, dbPath, onProgress: beforeFirstRead(replaceWithDirectory) })).rejects.toThrow(
      /EISDIR/,
    );
  });

  it("counts nothing when every log file is still there", async () => {
    expect((await refresh({ logsRoot, dbPath })).vanishedLogFilesSkipped).toBe(0);
  });
});
