// Continuations (log-format §10): a resumed or forked session's file starts
// with a copy of its parent's records, same uuids. A Refresh links it to its
// parent — the session whose `continued-in` record names it, else the one
// whose Messages it holds all of. A forked Sub-agent's file likewise starts
// with a copy of its spawning Agent's records. Of the Agents holding a
// Message, one owns it — the ancestor, else the smallest log path — and every
// other occurrence is a Copied Message (ADR-0011). Read back through
// `listConversations` and `getTranscript`, never SQL.

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { getTranscript, listConversations } from "@/core/read";
import { refresh } from "@/core/refresh";

import { type SessionLog, writeSessionLog } from "./helpers/session-log";
import { seededTempDb } from "./helpers/temp-db";

const FIXTURES_ROOT = path.join(import.meta.dirname, "fixtures", "family-logs");

/** Each Conversation's `continuedFromId`, by session id. */
async function continuedFromById(dbPath: string): Promise<Record<string, string | null>> {
  const rows = await listConversations({ dbPath });
  return Object.fromEntries(rows.map((row) => [row.id, row.continuedFromId]));
}

/** The owner each of one Agent's rendered Messages names, by uuid: null on one it owns. */
async function copiedFromByUuid(dbPath: string, sessionId: string, agentId?: string) {
  const transcript = await getTranscript(sessionId, { dbPath, agentId, page: "all" });
  return Object.fromEntries((transcript?.messages ?? []).map((m) => [m.uuid, m.copiedFrom]));
}

/** The uuids of one Agent's rendered Messages that are Copied Messages, and of those that are not. */
async function copiedAndOwnUuids(dbPath: string, sessionId: string, agentId?: string) {
  const transcript = await getTranscript(sessionId, { dbPath, agentId, page: "all" });
  const messages = transcript?.messages ?? [];
  return {
    copied: messages.filter((m) => m.isCopied).map((m) => m.uuid),
    own: messages.filter((m) => !m.isCopied).map((m) => m.uuid),
  };
}

describe("a cold Refresh of copied sessions", () => {
  const db = seededTempDb({ prefix: "cca-continuation-", logsRoot: FIXTURES_ROOT });

  it("links each continuation to the session whose continued-in record names it", async () => {
    const links = await continuedFromById(db.dbPath);

    expect(links["sess-fam-a"]).toBeNull();
    expect(links["sess-fam-b"]).toBe("sess-fam-a");
    // sess-fam-c copies through sess-fam-b, one of sess-fam-b's own Messages included.
    expect(links["sess-fam-c"]).toBe("sess-fam-b");
    // sess-fam-d forks sess-fam-a at the very point sess-fam-b copied.
    expect(links["sess-fam-d"]).toBe("sess-fam-a");
    expect(links["sess-fam-e"]).toBe("sess-fam-d");
    expect(links["sess-orphan"]).toBeNull();
    expect(links["sess-fam-solo"]).toBeNull();
  });

  it("links a copy no record names to the session whose Messages it holds all of", async () => {
    const links = await continuedFromById(db.dbPath);

    expect(links["sess-legacy-b"]).toBe("sess-legacy-a");
    expect(links["sess-legacy-a"]).toBeNull();
    // A near-fork: each holds a Message the other lacks, and no record tells.
    expect(links["sess-legacy-fork"]).toBeNull();
  });

  it("marks as copied a continuation's copy of its parent's Messages, and only those", async () => {
    expect(await copiedAndOwnUuids(db.dbPath, "sess-fam-c")).toEqual({
      copied: ["fam-a-u1", "fam-a-a1", "fam-b-u1", "fam-b-a1"],
      own: ["fam-c-u1", "fam-c-a1"],
    });
    expect(await copiedAndOwnUuids(db.dbPath, "sess-legacy-b")).toEqual({
      copied: ["leg-u1", "leg-a1", "leg-u2"],
      own: ["leg-b-a1"],
    });
  });

  it("an original owns its Messages, and so does a copy whose original is gone, their only holder", async () => {
    expect((await copiedAndOwnUuids(db.dbPath, "sess-fam-a")).copied).toEqual([]);
    expect((await copiedAndOwnUuids(db.dbPath, "sess-legacy-a")).copied).toEqual([]);
    expect(await copiedAndOwnUuids(db.dbPath, "sess-orphan")).toEqual({
      copied: [],
      own: ["gone-u1", "gone-a1", "orph-u1", "orph-a1"],
    });
  });

  it("marks as copied a near-fork's shared Messages, owned by the holder of the smallest log path", async () => {
    // No record links sess-legacy-fork to sess-legacy-a, and neither holds all of the other's Messages.
    expect(await copiedAndOwnUuids(db.dbPath, "sess-legacy-fork")).toEqual({
      copied: ["leg-u1", "leg-a1"],
      own: ["leg-fork-u1"],
    });
  });

  it("names the occurrence each Copied Message is from: its owner's session, title and Message", async () => {
    const copiedFrom = await copiedFromByUuid(db.dbPath, "sess-fam-c");
    // The Main thread's key is not stable, so a Main-thread owner names none.
    expect(copiedFrom["fam-a-u1"]).toEqual({
      sessionId: "sess-fam-a",
      title: "Family root",
      agentId: null,
      messageUuid: "fam-a-u1",
    });
    expect(copiedFrom["fam-b-a1"]).toMatchObject({ sessionId: "sess-fam-b", agentId: null, messageUuid: "fam-b-a1" });
    expect(copiedFrom["fam-c-u1"]).toBeNull();
    expect((await copiedFromByUuid(db.dbPath, "sess-fam-b", "fam-helper"))["fam-helper-u1"]).toMatchObject({
      sessionId: "sess-fam-a",
      agentId: "fam-helper",
    });
  });

  it("marks as copied a Sub-agent transcript copied along with its parent's records", async () => {
    expect(await copiedAndOwnUuids(db.dbPath, "sess-fam-b", "fam-helper")).toEqual({
      copied: ["fam-helper-u1", "fam-helper-a1"],
      own: [],
    });
    expect((await copiedAndOwnUuids(db.dbPath, "sess-fam-a", "fam-helper")).copied).toEqual([]);
  });
});

describe("a cold Refresh of forked Sub-agents", () => {
  const db = seededTempDb({
    prefix: "cca-forked-agent-",
    logsRoot: path.join(import.meta.dirname, "fixtures", "forked-agent-logs"),
  });

  it("marks as copied a fork's copy of its spawning Sub-agent's Messages, its re-written spawn record included", async () => {
    // fork-a-a1 is the spawner's spawning Turn under a new uuid: the spawner owns it.
    expect(await copiedAndOwnUuids(db.dbPath, "sess-forks", "fork-a")).toEqual({
      copied: ["lead-u1", "lead-a1", "lead-a1b", "fork-a-a1"],
      own: ["fork-a-a2", "fork-a-a3", "fork-a-a4"],
    });
  });

  it("marks as copied a fork of a fork's copy, the first fork's own Messages and its re-written spawn record included", async () => {
    expect(await copiedAndOwnUuids(db.dbPath, "sess-forks", "fork-b")).toEqual({
      copied: ["lead-u1", "lead-a1", "lead-a1b", "fork-a-a1", "fork-a-a2", "fork-b-a1"],
      own: ["fork-b-a2"],
    });
  });

  it("names a fork's copies as from the root spawner, at its own occurrence of a re-written spawn record", async () => {
    const copiedFrom = await copiedFromByUuid(db.dbPath, "sess-forks", "fork-b");
    const fromForkLead = { sessionId: "sess-forks", title: "audit the runs", agentId: "fork-lead" };
    expect(copiedFrom["lead-u1"]).toEqual({ ...fromForkLead, messageUuid: "lead-u1" });
    // fork-a-a1 re-writes fork-lead's spawning Turn, lead-a2 in fork-lead's file.
    expect(copiedFrom["fork-a-a1"]).toEqual({ ...fromForkLead, messageUuid: "lead-a2" });
    expect(copiedFrom["fork-a-a2"]).toEqual({ ...fromForkLead, agentId: "fork-a", messageUuid: "fork-a-a2" });
    expect(copiedFrom["fork-b-a2"]).toBeNull();
    expect((await copiedFromByUuid(db.dbPath, "sess-main-fork", "main-fork"))["main-fork-a1"]).toEqual({
      sessionId: "sess-main-fork",
      title: "name the tables",
      agentId: null,
      messageUuid: "mainfork-a1",
    });
  });

  it("marks nothing as copied in the Sub-agent that was forked, nor in the Main thread", async () => {
    expect((await copiedAndOwnUuids(db.dbPath, "sess-forks", "fork-lead")).copied).toEqual([]);
    expect((await copiedAndOwnUuids(db.dbPath, "sess-forks")).copied).toEqual([]);
  });

  it("marks as copied a Main-thread fork's re-written spawning Turn, after its fork-context-ref", async () => {
    expect(await copiedAndOwnUuids(db.dbPath, "sess-main-fork", "main-fork")).toEqual({
      copied: ["main-fork-a1"],
      own: ["main-fork-a2"],
    });
    expect((await copiedAndOwnUuids(db.dbPath, "sess-main-fork")).copied).toEqual([]);
  });
});

describe("a cold Refresh of copied sessions written by hand", () => {
  const tmpDirs: string[] = [];
  afterEach(() => {
    for (const tmpDir of tmpDirs.splice(0)) rmSync(tmpDir, { recursive: true, force: true });
  });

  /** Write `logs` to a new logs root, Refresh it cold into a new database, and return the database's path. */
  async function refreshedDbOf(logs: SessionLog[]): Promise<string> {
    const tmpDir = mkdtempSync(path.join(tmpdir(), "cca-continuation-shapes-"));
    tmpDirs.push(tmpDir);
    const logsRoot = path.join(tmpDir, "logs");
    for (const log of logs) writeSessionLog(logsRoot, log);
    const dbPath = path.join(tmpDir, "analyzer.db");
    await refresh({ logsRoot, dbPath });
    return dbPath;
  }

  it("takes the smallest source path for the original of two sessions holding the same Messages", async () => {
    const dbPath = await refreshedDbOf([
      { sessionId: "sess-same-b", messageUuids: ["same-u1", "same-u2"] },
      { sessionId: "sess-same-a", messageUuids: ["same-u1", "same-u2"] },
    ]);

    const links = await continuedFromById(dbPath);
    expect(links["sess-same-a"]).toBeNull();
    expect(links["sess-same-b"]).toBe("sess-same-a");
    expect((await copiedAndOwnUuids(dbPath, "sess-same-b")).copied).toEqual(["same-u1", "same-u2"]);
  });

  it("links a session a record names even when it holds none of the namer's Messages", async () => {
    const dbPath = await refreshedDbOf([
      {
        sessionId: "sess-namer",
        messageUuids: ["namer-u1", "namer-u2"],
        continuedInSessionIds: ["sess-named", "sess-quit"],
      },
      // A compacted copy: none of the namer's records.
      { sessionId: "sess-named", messageUuids: ["named-u1"] },
      // Resumed, then quit before any Message.
      { sessionId: "sess-quit", messageUuids: [] },
    ]);

    const links = await continuedFromById(dbPath);
    expect(links["sess-named"]).toBe("sess-namer");
    expect(links["sess-quit"]).toBe("sess-namer");
    expect((await copiedAndOwnUuids(dbPath, "sess-named")).copied).toEqual([]);
  });

  it("links a grandchild to the parent it shares the longest leading run with, when no record names it", async () => {
    const dbPath = await refreshedDbOf([
      { sessionId: "sess-gen-1", messageUuids: ["gen-u1", "gen-u2"] },
      { sessionId: "sess-gen-2", messageUuids: ["gen-u1", "gen-u2", "gen-2-u3"] },
      { sessionId: "sess-gen-3", messageUuids: ["gen-u1", "gen-u2", "gen-2-u3", "gen-3-u4"] },
    ]);

    const links = await continuedFromById(dbPath);
    expect(links["sess-gen-1"]).toBeNull();
    expect(links["sess-gen-2"]).toBe("sess-gen-1");
    expect(links["sess-gen-3"]).toBe("sess-gen-2");
    expect((await copiedAndOwnUuids(dbPath, "sess-gen-3")).copied).toEqual(["gen-u1", "gen-u2", "gen-2-u3"]);
  });
});
