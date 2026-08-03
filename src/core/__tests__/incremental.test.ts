import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPrismaClient } from "@/core/db";
import { getConversation, listConversations } from "@/core/read";
import { refresh } from "@/core/refresh";

/**
 * Fault injection for the "interrupted refresh" test: when ARMED, the next
 * `message.findFirst` on a client handed out by `createPrismaClient` throws,
 * then disarms.
 *
 * WHY `message.findFirst`: it is the FIRST database call of the
 * continued-from resolution pass (`resolveContinuedFrom` in refresh.ts) and the
 * ONLY `findFirst` in core — the read seams never call it. Arming it therefore
 * aborts a refresh at exactly the hazard window this suite pins: after every
 * conversation has been written, before any continuation link is resolved. If a
 * refactor moves or renames that call, this injection stops reproducing the
 * interruption — the test guards against that by asserting the aborted run DID
 * write its conversation rows, so a crash that drifts earlier fails loudly
 * instead of passing vacuously.
 */
const crash = vi.hoisted(() => ({ armed: false }));

vi.mock("@/core/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/core/db")>();
  return {
    ...actual,
    createPrismaClient: (dbPath?: string) => {
      const client = actual.createPrismaClient(dbPath);
      return new Proxy(client, {
        get(target, prop, receiver) {
          const value: unknown = Reflect.get(target, prop, receiver);
          if (prop !== "message") return value;
          return new Proxy(value as object, {
            get(model, method, modelReceiver) {
              if (method === "findFirst" && crash.armed) {
                return () => {
                  crash.armed = false;
                  throw new Error("simulated interruption");
                };
              }
              return Reflect.get(model, method, modelReceiver) as unknown;
            },
          });
        },
      });
    },
  };
});

const FIXTURES_ROOT = path.join(import.meta.dirname, "fixtures", "logs");

/** Bump a file's mtime so the (mtime,size) change key differs. */
function touchLater(filePath: string): void {
  const future = new Date(Date.now() + 60_000);
  utimesSync(filePath, future, future);
}

/** Count rows across every table for a duplication check. */
async function rowCounts(dbPath: string): Promise<Record<string, number>> {
  const prisma = createPrismaClient(dbPath);
  try {
    return {
      project: await prisma.project.count(),
      conversation: await prisma.conversation.count(),
      agent: await prisma.agent.count(),
      message: await prisma.message.count(),
      toolCall: await prisma.toolCall.count(),
      prLink: await prisma.prLink.count(),
      turnDuration: await prisma.turnDuration.count(),
    };
  } finally {
    await prisma.$disconnect();
  }
}

/** Every conversation's row id, keyed by session id (row-identity evidence). */
async function conversationRowIds(dbPath: string): Promise<Map<string, number>> {
  const prisma = createPrismaClient(dbPath);
  try {
    const rows = await prisma.conversation.findMany({
      select: { id: true, sessionId: true },
    });
    return new Map(rows.map((r) => [r.sessionId, r.id]));
  } finally {
    await prisma.$disconnect();
  }
}

/** The source file a conversation row is currently ingested from. */
async function conversationSourcePath(
  dbPath: string,
  sessionId: string,
): Promise<string | undefined> {
  const prisma = createPrismaClient(dbPath);
  try {
    return (
      await prisma.conversation.findUnique({
        where: { sessionId },
        select: { sourcePath: true },
      })
    )?.sourcePath;
  } finally {
    await prisma.$disconnect();
  }
}

/** Rewrite the stored parser version of every conversation (upgrade sim). */
async function setStoredParserVersion(
  dbPath: string,
  version: number,
): Promise<void> {
  const prisma = createPrismaClient(dbPath);
  try {
    await prisma.conversation.updateMany({ data: { parserVersion: version } });
  } finally {
    await prisma.$disconnect();
  }
}

describe("incremental refresh", () => {
  let tmpDir: string;
  let logsRoot: string;
  let dbPath: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(path.join(tmpdir(), "cca-incr-"));
    logsRoot = path.join(tmpDir, "logs");
    dbPath = path.join(tmpDir, "analyzer.db");
    // Mutable copy of the committed fixtures.
    cpSync(FIXTURES_ROOT, logsRoot, { recursive: true });
  });

  afterEach(() => {
    crash.armed = false;
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("skips every unchanged conversation on a second refresh (no re-parse, no dup rows)", async () => {
    const first = await refresh({ logsRoot, dbPath });
    expect(first.conversationsParsed).toBeGreaterThanOrEqual(1);
    expect(first.conversationsSkipped).toBe(0);

    const before = await rowCounts(dbPath);

    const second = await refresh({ logsRoot, dbPath });
    expect(second.conversationsParsed).toBe(0);
    expect(second.conversationsSkipped).toBe(first.conversationsParsed);
    expect(second.conversationsDeleted).toBe(0);
    // An unchanged conversation contributes 0 malformed lines on re-refresh.
    expect(second.malformedLinesSkipped).toBe(0);

    const after = await rowCounts(dbPath);
    expect(after).toEqual(before); // no duplication
  });

  it("re-parses a changed main file without duplicating its rows", async () => {
    await refresh({ logsRoot, dbPath });
    const before = await rowCounts(dbPath);

    // Mutate sess-basic's content (changes size) AND mtime.
    const basicPath = path.join(logsRoot, "-Users-me-dev-demo", "sess-basic.jsonl");
    const extra =
      '{"type":"user","uuid":"x-extra","timestamp":"2026-06-20T10:02:00.000Z","cwd":"/Users/me/dev/demo","message":{"role":"user","content":"one more"}}\n';
    const original = await import("node:fs").then((fs) =>
      fs.readFileSync(basicPath, "utf8"),
    );
    writeFileSync(basicPath, original + extra);
    touchLater(basicPath);

    const second = await refresh({ logsRoot, dbPath });
    expect(second.conversationsParsed).toBe(1);
    expect(second.conversationsSkipped).toBeGreaterThanOrEqual(1);

    const after = await rowCounts(dbPath);
    // Exactly one message row added (the new user turn); nothing duplicated.
    expect(after.conversation).toBe(before.conversation);
    expect(after.message).toBe(before.message + 1);

    // The conversation still reads correctly (tokens unchanged by a user turn).
    const basic = (await listConversations({ dbPath })).find(
      (c) => c.id === "sess-basic",
    );
    expect(basic?.tokens.output).toBe(550);
  });

  it("parses a brand-new file appearing on a second refresh", async () => {
    const first = await refresh({ logsRoot, dbPath });

    const newDir = path.join(logsRoot, "-Users-me-dev-demo");
    const newPath = path.join(newDir, "sess-new.jsonl");
    writeFileSync(
      newPath,
      [
        '{"type":"user","uuid":"n0","timestamp":"2026-06-20T12:00:00.000Z","cwd":"/Users/me/dev/demo","message":{"role":"user","content":"new session"}}',
        '{"type":"assistant","uuid":"n1","requestId":"nr1","timestamp":"2026-06-20T12:00:05.000Z","cwd":"/Users/me/dev/demo","message":{"id":"nmsg-1","role":"assistant","model":"claude-sonnet-4-6","content":[{"type":"text","text":"hi"}],"usage":{"input_tokens":5,"output_tokens":7,"cache_creation_input_tokens":0,"cache_read_input_tokens":0,"cache_creation":{"ephemeral_5m_input_tokens":0,"ephemeral_1h_input_tokens":0}}}}',
        "",
      ].join("\n"),
    );

    const second = await refresh({ logsRoot, dbPath });
    expect(second.conversationsParsed).toBe(1);
    expect(second.conversationsSkipped).toBe(first.conversationsParsed);

    const convos = await listConversations({ dbPath });
    const fresh = convos.find((c) => c.id === "sess-new");
    expect(fresh).toBeDefined();
    expect(fresh?.tokens.output).toBe(7);
  });

  it("deletes a conversation whose source file disappeared (cascade)", async () => {
    await refresh({ logsRoot, dbPath });
    expect(
      (await listConversations({ dbPath })).some((c) => c.id === "sess-tools"),
    ).toBe(true);

    // Remove the sess-tools transcript (it has tool_call/pr_link/turn_duration).
    rmSync(path.join(logsRoot, "-Users-me-dev-tools", "sess-tools.jsonl"));

    const second = await refresh({ logsRoot, dbPath });
    expect(second.conversationsDeleted).toBe(1);

    const convos = await listConversations({ dbPath });
    expect(convos.some((c) => c.id === "sess-tools")).toBe(false);

    // Cascade: no orphaned rows remain for the deleted conversation.
    const prisma = createPrismaClient(dbPath);
    try {
      const orphanPr = await prisma.prLink.findMany({
        where: { prNumber: 42 },
      });
      expect(orphanPr).toHaveLength(0);
    } finally {
      await prisma.$disconnect();
    }
  });

  it("resolves continued_from to a parent that was SKIPPED on this refresh", async () => {
    // First refresh ingests the parent (sess-origin). On a SECOND refresh a NEW
    // child appears whose first-message parentUuid points into the parent — but
    // the parent is UNCHANGED and thus skipped (not re-parsed). The link must
    // still resolve, authoritatively, against the persisted parent rows.
    const resumeDir = path.join(logsRoot, "-Users-me-dev-resume");
    const childPath = path.join(resumeDir, "sess-child.jsonl");

    // Remove the committed sibling that would otherwise be parsed in the same
    // run, so the parent is the ONLY thing the child can resolve against — and
    // it is already on disk + in the DB from the first refresh.
    rmSync(path.join(resumeDir, "sess-resumed.jsonl"));

    await refresh({ logsRoot, dbPath });
    const originBefore = (await listConversations({ dbPath })).find(
      (c) => c.id === "sess-origin",
    );
    expect(originBefore).toBeDefined();

    // A brand-new child resuming from sess-origin's last message (orig-a1).
    writeFileSync(
      childPath,
      [
        '{"type":"ai-title","aiTitle":"Child of origin"}',
        '{"type":"user","uuid":"child-u1","parentUuid":"orig-a1","timestamp":"2026-06-20T09:00:00.000Z","cwd":"/Users/me/dev/resume","version":"2.1.180","message":{"role":"user","content":"resume from origin"}}',
        '{"type":"assistant","uuid":"child-a1","parentUuid":"child-u1","requestId":"creq-1","timestamp":"2026-06-20T09:00:05.000Z","cwd":"/Users/me/dev/resume","version":"2.1.180","message":{"id":"cmsg-1","role":"assistant","model":"claude-sonnet-4-6","content":[{"type":"text","text":"continued"}],"usage":{"input_tokens":5,"output_tokens":5,"cache_creation_input_tokens":0,"cache_read_input_tokens":0,"cache_creation":{"ephemeral_5m_input_tokens":0,"ephemeral_1h_input_tokens":0}}}}',
        "",
      ].join("\n"),
    );

    const second = await refresh({ logsRoot, dbPath });
    // The parent was skipped (unchanged); only the child was parsed.
    expect(second.conversationsParsed).toBe(1);
    expect(second.conversationsSkipped).toBeGreaterThanOrEqual(1);

    const convos = await listConversations({ dbPath });
    const origin = convos.find((c) => c.id === "sess-origin");
    const child = convos.find((c) => c.id === "sess-child");
    expect(origin).toBeDefined();
    expect(child).toBeDefined();

    // The link resolves even though the parent was not re-parsed this run.
    expect(child?.continuedFromId).toBe("sess-origin");
    // Parent and child stay DISTINCT rows; the parent has no continuation.
    expect(origin?.continuedFromId).toBeNull();
    expect(child?.id).not.toBe(origin?.id);
  });

  it("completes continued_from links left unresolved by an INTERRUPTED refresh", async () => {
    // A refresh that dies between the conversation writes and the continuation
    // linking pass must not strand those conversations: they are written but NOT
    // yet stamped as up-to-date, so the next refresh re-parses them and resolves
    // their links. Stamping them at write time would make the next refresh skip
    // them and lose `continuedFromConversationId` forever.
    const resumeDir = path.join(logsRoot, "-Users-me-dev-resume");
    rmSync(path.join(resumeDir, "sess-resumed.jsonl"));
    writeFileSync(
      path.join(resumeDir, "sess-child.jsonl"),
      [
        '{"type":"ai-title","aiTitle":"Child of origin"}',
        '{"type":"user","uuid":"child-u1","parentUuid":"orig-a1","timestamp":"2026-06-20T09:00:00.000Z","cwd":"/Users/me/dev/resume","version":"2.1.180","message":{"role":"user","content":"resume from origin"}}',
        '{"type":"assistant","uuid":"child-a1","parentUuid":"child-u1","requestId":"creq-1","timestamp":"2026-06-20T09:00:05.000Z","cwd":"/Users/me/dev/resume","version":"2.1.180","message":{"id":"cmsg-1","role":"assistant","model":"claude-sonnet-4-6","content":[{"type":"text","text":"continued"}],"usage":{"input_tokens":5,"output_tokens":5,"cache_creation_input_tokens":0,"cache_read_input_tokens":0,"cache_creation":{"ephemeral_5m_input_tokens":0,"ephemeral_1h_input_tokens":0}}}}',
        "",
      ].join("\n"),
    );

    crash.armed = true;
    await expect(refresh({ logsRoot, dbPath })).rejects.toThrow(
      "simulated interruption",
    );
    expect(crash.armed).toBe(false); // the injected fault really fired

    // The interruption happened AFTER the writes: the rows are there, unlinked.
    const interrupted = await listConversations({ dbPath });
    expect(interrupted.some((c) => c.id === "sess-origin")).toBe(true);
    expect(interrupted.find((c) => c.id === "sess-child")?.continuedFromId).toBeNull();
    const afterCrash = await rowCounts(dbPath);

    // The next refresh repairs what the interrupted run left behind.
    await refresh({ logsRoot, dbPath });
    const repaired = await listConversations({ dbPath });
    expect(repaired.find((c) => c.id === "sess-child")?.continuedFromId).toBe(
      "sess-origin",
    );
    expect(repaired.find((c) => c.id === "sess-origin")?.continuedFromId).toBeNull();

    // Re-parsing the interrupted run's conversations rewrote them wholesale
    // (delete + cascade + re-write), including their sub-agent rows — no
    // duplication anywhere.
    expect(await rowCounts(dbPath)).toEqual(afterCrash);

    // And the repaired state is stamped: the run after it skips everything.
    const third = await refresh({ logsRoot, dbPath });
    expect(third.conversationsParsed).toBe(0);
    expect(third.conversationsSkipped).toBe(repaired.length);
  });

  it("re-parses every conversation exactly once after a parser-version bump, then skips again", async () => {
    const first = await refresh({ logsRoot, dbPath });
    const total = first.conversationsParsed;
    expect(total).toBeGreaterThanOrEqual(2);

    const before = await conversationRowIds(dbPath);

    // Simulate rows ingested by an OLDER parser (what an upgrade leaves behind:
    // the new column's default). The source files are untouched, so the
    // mtime/size key still matches — only the parser version differs.
    await setStoredParserVersion(dbPath, 0);

    const second = await refresh({ logsRoot, dbPath });
    // Evidence of a real re-parse, not merely "no duplicates": every
    // conversation was parsed and none skipped...
    expect(second.conversationsParsed).toBe(total);
    expect(second.conversationsSkipped).toBe(0);

    // ...and every conversation row was deleted and re-inserted, so its row id
    // is brand new while the session set and row counts are unchanged.
    const after = await conversationRowIds(dbPath);
    expect([...after.keys()].sort()).toEqual([...before.keys()].sort());
    for (const [sessionId, id] of after) {
      expect(id).not.toBe(before.get(sessionId));
    }

    // Exactly once: the next refresh skips everything again, ids now stable.
    const third = await refresh({ logsRoot, dbPath });
    expect(third.conversationsParsed).toBe(0);
    expect(third.conversationsSkipped).toBe(total);
    expect(await conversationRowIds(dbPath)).toEqual(after);
  });

  it("re-parses the parent when only a sub-agent transcript changes", async () => {
    await refresh({ logsRoot, dbPath });
    const before = await getConversation("sess-sub", { dbPath });
    expect(before).not.toBeNull();

    // Append an assistant turn to the SUB-AGENT file only; the main session file
    // is untouched. A main-file-only mtime/size check would miss this.
    const subPath = path.join(
      logsRoot,
      "-Users-me-dev-sub",
      "sess-sub",
      "subagents",
      "agent-sub1.jsonl",
    );
    const extra =
      '{"type":"assistant","uuid":"sa3","isSidechain":true,"agentId":"sub1","requestId":"sreq-3","timestamp":"2026-06-20T08:00:30.000Z","cwd":"/Users/me/dev/sub","version":"2.1.180","attributionAgent":"Explore","message":{"id":"smsg-3","role":"assistant","model":"claude-haiku-4-5-20251001","content":[{"type":"text","text":"more"}],"usage":{"input_tokens":0,"output_tokens":11,"cache_creation_input_tokens":0,"cache_read_input_tokens":0,"cache_creation":{"ephemeral_5m_input_tokens":0,"ephemeral_1h_input_tokens":0}}}}\n';
    const fs = await import("node:fs");
    fs.writeFileSync(subPath, fs.readFileSync(subPath, "utf8") + extra);
    touchLater(subPath);

    const second = await refresh({ logsRoot, dbPath });
    // The parent conversation was re-parsed because its composite key changed.
    expect(second.conversationsParsed).toBe(1);

    const after = await getConversation("sess-sub", { dbPath });
    // The extra sub-agent output (11) rolled up; no duplication of prior rows.
    expect(after?.tokens.output).toBe((before?.tokens.output ?? 0) + 11);
    expect(after?.subAgentCount).toBe(1);
  });

  it("keeps the smallest-path file when two log files share a session id, and reports the skip", async () => {
    // The stray-copy case: the same `<sessionId>.jsonl` sits in two project
    // folders. `sessionId` is unique in the schema, so ingesting both would
    // violate the constraint and abort the WHOLE run. One file must win —
    // deterministically, by smallest source path — and the loser must be
    // reported, not silently dropped.
    const [keptPath, skippedPath] = writeDuplicatePair(logsRoot);

    const summary = await refresh({ logsRoot, dbPath });

    // The run completed and ingested everything else in the fixture set.
    expect(summary.conversationsParsed).toBeGreaterThanOrEqual(2);
    const convos = await listConversations({ dbPath });
    expect(convos.some((c) => c.id === "sess-basic")).toBe(true);

    // Exactly one row for the shared session id — the smallest-path file's.
    const dupes = convos.filter((c) => c.id === "sess-copy");
    expect(dupes).toHaveLength(1);
    expect(dupes[0]?.title).toBe("The kept copy");

    // The skip is observable, and names the file the user should delete.
    expect(summary.duplicateSessionsSkipped).toEqual([
      { sessionId: "sess-copy", keptPath, skippedPath },
    ]);
  });

  it("re-parses from the new winner when a smaller-path duplicate appears next to an ingested conversation", async () => {
    // Dedupe runs at DISCOVERY, before the incremental compare — so the winner
    // is decided by the file set on disk, not by what happens to be in the
    // database already. A copy landing at a SMALLER path takes over the session
    // id, and the previously ingested file becomes the reported duplicate.
    const strayPath = writeSessionCopy(
      logsRoot,
      "-Users-me-dev-copy-b",
      "The stray copy",
    );
    await refresh({ logsRoot, dbPath });
    expect(
      (await listConversations({ dbPath })).find((c) => c.id === "sess-copy")
        ?.title,
    ).toBe("The stray copy");

    const keptPath = writeSessionCopy(
      logsRoot,
      "-Users-me-dev-copy-a",
      "The kept copy — appeared later",
    );

    const second = await refresh({ logsRoot, dbPath });

    expect(second.duplicateSessionsSkipped).toEqual([
      { sessionId: "sess-copy", keptPath, skippedPath: strayPath },
    ]);
    const convos = await listConversations({ dbPath });
    expect(convos.filter((c) => c.id === "sess-copy")).toHaveLength(1);
    expect(convos.find((c) => c.id === "sess-copy")?.title).toBe(
      "The kept copy — appeared later",
    );
  });

  it("re-parses when the winning duplicate has the same mtime and size as the ingested one", async () => {
    // A metadata-preserving copy (`cp -p`) at a SMALLER path wins the session id
    // while presenting an identical composite key. Comparing only
    // (parserVersion, mtime, size) would call the conversation unchanged and
    // leave the row pointing at — and holding the content of — the file the
    // summary just reported as skipped. The stored source path is part of the
    // change decision precisely so the winner switch is honoured.
    const sameTime = new Date(2026, 0, 1);
    const strayPath = writeSessionCopy(
      logsRoot,
      "-Users-me-dev-copy-b",
      "Same bytes either way",
    );
    utimesSync(strayPath, sameTime, sameTime);

    await refresh({ logsRoot, dbPath });
    expect(await conversationSourcePath(dbPath, "sess-copy")).toBe(strayPath);

    // Byte-identical, same mtime: the stored (mtime, size) key still matches.
    const keptPath = writeSessionCopy(
      logsRoot,
      "-Users-me-dev-copy-a",
      "Same bytes either way",
    );
    utimesSync(keptPath, sameTime, sameTime);

    const second = await refresh({ logsRoot, dbPath });

    expect(second.conversationsParsed).toBe(1);
    expect(second.duplicateSessionsSkipped).toEqual([
      { sessionId: "sess-copy", keptPath, skippedPath: strayPath },
    ]);
    // The row now belongs to the file the summary reports as kept.
    expect(await conversationSourcePath(dbPath, "sess-copy")).toBe(keptPath);
  });

  it("reports no duplicates when every session id is unique", async () => {
    const summary = await refresh({ logsRoot, dbPath });
    expect(summary.duplicateSessionsSkipped).toEqual([]);
  });
});

/**
 * Plant `sess-copy.jsonl` in one project folder and return its path. The title
 * is the only difference between two copies, so an assertion on the ingested
 * title says exactly WHICH file won.
 */
function writeSessionCopy(
  logsRoot: string,
  folder: string,
  title: string,
): string {
  const dir = path.join(logsRoot, folder);
  mkdirSync(dir, { recursive: true });
  const filePath = path.join(dir, "sess-copy.jsonl");
  writeFileSync(
    filePath,
    [
      `{"type":"ai-title","aiTitle":${JSON.stringify(title)}}`,
      '{"type":"user","uuid":"c0","timestamp":"2026-06-20T13:00:00.000Z","cwd":"/Users/me/dev/copy","message":{"role":"user","content":"copied session"}}',
      '{"type":"assistant","uuid":"c1","requestId":"creq-9","timestamp":"2026-06-20T13:00:05.000Z","cwd":"/Users/me/dev/copy","message":{"id":"cmsg-9","role":"assistant","model":"claude-sonnet-4-6","content":[{"type":"text","text":"hi"}],"usage":{"input_tokens":3,"output_tokens":4,"cache_creation_input_tokens":0,"cache_read_input_tokens":0,"cache_creation":{"ephemeral_5m_input_tokens":0,"ephemeral_1h_input_tokens":0}}}}',
      "",
    ].join("\n"),
  );
  return filePath;
}

/**
 * Plant the same session id in two project folders and return
 * `[smallestPath, otherPath]` — the expected winner first ("-a" sorts before
 * "-b").
 */
function writeDuplicatePair(logsRoot: string): [string, string] {
  return [
    writeSessionCopy(logsRoot, "-Users-me-dev-copy-a", "The kept copy"),
    writeSessionCopy(logsRoot, "-Users-me-dev-copy-b", "The stray copy"),
  ];
}
