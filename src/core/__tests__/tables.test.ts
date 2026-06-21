import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createPrismaClient } from "@/core/db";
import { listConversations, refresh } from "@/core/refresh";

const FIXTURES_ROOT = path.join(import.meta.dirname, "fixtures", "logs");

describe("Slice 4 side tables", () => {
  let tmpDir: string;
  let dbPath: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(path.join(tmpdir(), "cca-tables-"));
    dbPath = path.join(tmpDir, "analyzer.db");
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("writes a tool_call row per tool_use with mapped input and paired result", async () => {
    await refresh({ logsRoot: FIXTURES_ROOT, dbPath });
    const prisma = createPrismaClient(dbPath);
    try {
      const calls = await prisma.toolCall.findMany({ orderBy: { toolUseId: "asc" } });
      const bash = calls.find((c) => c.toolUseId === "toolu-bash-1");
      const skill = calls.find((c) => c.toolUseId === "toolu-skill-1");

      expect(bash).toBeDefined();
      expect(skill).toBeDefined();
      if (!bash || !skill) return;

      // Bash tool call: name + full input JSON (command/description preserved).
      expect(bash.name).toBe("Bash");
      const bashInput = JSON.parse(bash.inputJson) as { command: string };
      expect(bashInput.command).toBe("echo hi");
      // Result paired from the FOLLOWING user record's toolUseResult.
      expect(bash.resultText).toContain("hi");
      expect(bash.isError).toBe(false);
      expect(bash.resultTruncated).toBe(false);
      expect(bash.resultCharSize).toBeGreaterThan(0);

      // Skill invocation: input.skill preserved; result flagged as error.
      expect(skill.name).toBe("Skill");
      const skillInput = JSON.parse(skill.inputJson) as { skill: string };
      expect(skillInput.skill).toBe("commit");
      expect(skill.isError).toBe(true);
    } finally {
      await prisma.$disconnect();
    }
  });

  it("writes pr_link and turn_duration rows from their records", async () => {
    await refresh({ logsRoot: FIXTURES_ROOT, dbPath });
    const prisma = createPrismaClient(dbPath);
    try {
      const convo = await prisma.conversation.findUnique({
        where: { sessionId: "sess-tools" },
      });
      expect(convo).not.toBeNull();
      if (!convo) return;

      const prLinks = await prisma.prLink.findMany({
        where: { conversationId: convo.id },
      });
      expect(prLinks).toHaveLength(1);
      expect(prLinks[0]?.prNumber).toBe(42);
      expect(prLinks[0]?.prUrl).toBe("https://github.com/me/demo/pull/42");
      expect(prLinks[0]?.prRepository).toBe("me/demo");

      const durations = await prisma.turnDuration.findMany({
        where: { conversationId: convo.id },
      });
      expect(durations).toHaveLength(1);
      expect(Number(durations[0]?.durationMs)).toBe(11487);
      expect(durations[0]?.messageCount).toBe(6);
    } finally {
      await prisma.$disconnect();
    }
  });

  it("ingests a sub-agent transcript without double-counting its tokens", async () => {
    await refresh({ logsRoot: FIXTURES_ROOT, dbPath });

    // The transcript file is the single source of truth: the conversation total
    // = main thread + sub-agent transcript, each counted ONCE (the parent
    // Agent toolUseResult aggregate of 200 must NOT be added again).
    const convos = await listConversations({ dbPath });
    const sub = convos.find((c) => c.id === "sess-sub");
    expect(sub).toBeDefined();
    if (!sub) return;

    // main: input 10, output 15; sub: input 50, output 130, cacheRead 20.
    expect(sub.tokens.input).toBe(60);
    expect(sub.tokens.output).toBe(145);
    expect(sub.tokens.cacheRead).toBe(20);
    expect(sub.tokens.total).toBe(225); // NOT 425 (no double-count)
    expect(sub.subAgentCount).toBe(1);
    // two models present: opus (main) + haiku (sub).
    expect(sub.models.distinctCount).toBe(2);

    const prisma = createPrismaClient(dbPath);
    try {
      const convo = await prisma.conversation.findUnique({
        where: { sessionId: "sess-sub" },
      });
      if (!convo) throw new Error("missing convo");

      // The sub-agent agent row links back to the spawning Agent tool message.
      const subAgent = await prisma.agent.findFirst({
        where: { conversationId: convo.id, parentAgentId: { not: null } },
      });
      expect(subAgent).not.toBeNull();
      expect(subAgent?.agentType).toBe("Explore");
      expect(subAgent?.resolvedModel).toBe("claude-haiku-4-5-20251001");
      expect(subAgent?.spawnedByMessageId).not.toBeNull();

      const spawnMsg = await prisma.message.findUnique({
        where: { id: subAgent?.spawnedByMessageId ?? -1 },
      });
      expect(spawnMsg?.messageId).toBe("mmsg-1"); // the Agent tool_use turn

      // Cross-check (GOTCHA 3): the sub-agent transcript's own summed tokens
      // equal the parent Agent toolUseResult aggregate (200) — the same tokens.
      // We persist the transcript only; the aggregate is never summed in.
      const subTotal = await prisma.$queryRawUnsafe<{ t: number | bigint }[]>(
        `SELECT SUM(COALESCE(input_tokens,0)+COALESCE(output_tokens,0)
                   +COALESCE(cache_creation_5m_tokens,0)+COALESCE(cache_creation_1h_tokens,0)
                   +COALESCE(cache_read_tokens,0)) AS t
           FROM message WHERE agent_id = ?`,
        subAgent?.id ?? -1,
      );
      expect(Number(subTotal[0]?.t)).toBe(200);
    } finally {
      await prisma.$disconnect();
    }
  });

  it("resolves continued_from to a prior session, keeping both rows distinct", async () => {
    await refresh({ logsRoot: FIXTURES_ROOT, dbPath });
    const convos = await listConversations({ dbPath });

    const origin = convos.find((c) => c.id === "sess-origin");
    const resumed = convos.find((c) => c.id === "sess-resumed");
    expect(origin).toBeDefined();
    expect(resumed).toBeDefined();
    if (!origin || !resumed) return;

    // The resumed session's first message parentUuid resolves into sess-origin.
    expect(resumed.continuedFromId).toBe("sess-origin");
    // The origin started fresh — no continuation.
    expect(origin.continuedFromId).toBeNull();

    // Both remain DISTINCT rows; tokens are NOT merged.
    expect(origin.tokens.output).toBe(10);
    expect(resumed.tokens.output).toBe(20);
  });
});
