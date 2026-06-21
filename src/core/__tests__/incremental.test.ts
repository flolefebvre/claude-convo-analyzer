import {
  cpSync,
  mkdtempSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createPrismaClient } from "@/core/db";
import { getConversation, listConversations, refresh } from "@/core/refresh";

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
});
