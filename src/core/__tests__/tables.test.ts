import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createPrismaClient } from "@/core/db";
import { listConversations } from "@/core/read";
import { refresh } from "@/core/refresh";

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

  it("stores a log number that is no integer as missing: a fractional duration or token count, a string PR number", async () => {
    const logsRoot = path.join(tmpDir, "logs");
    const projectDir = path.join(logsRoot, "-Users-me-dev-malformed-numbers");
    mkdirSync(projectDir, { recursive: true });
    writeFileSync(
      path.join(projectDir, "sess-malformed-numbers.jsonl"),
      [
        '{"type":"user","uuid":"n-u1","timestamp":"2026-06-20T09:00:00.000Z","cwd":"/Users/me/dev/malformed-numbers","version":"2.1.180","message":{"role":"user","content":"hello"}}',
        '{"type":"assistant","uuid":"n-a1","parentUuid":"n-u1","requestId":"nreq-1","timestamp":"2026-06-20T09:00:05.000Z","cwd":"/Users/me/dev/malformed-numbers","version":"2.1.180","message":{"id":"nmsg-1","role":"assistant","model":"claude-sonnet-4-6","content":[{"type":"text","text":"hi"}],"usage":{"input_tokens":7.5,"output_tokens":3,"cache_creation_input_tokens":0,"cache_read_input_tokens":0,"cache_creation":{"ephemeral_5m_input_tokens":0,"ephemeral_1h_input_tokens":0}}}}',
        '{"type":"pr-link","prNumber":"42","prUrl":"https://github.com/me/demo/pull/42","prRepository":"me/demo","timestamp":"2026-06-20T09:00:08.000Z"}',
        '{"type":"system","subtype":"turn_duration","durationMs":12.5,"messageCount":2,"timestamp":"2026-06-20T09:00:09.000Z"}',
        "",
      ].join("\n"),
    );

    await refresh({ logsRoot, dbPath });
    const prisma = createPrismaClient(dbPath);
    try {
      const assistant = await prisma.message.findFirst({ where: { role: "assistant" } });
      expect(assistant?.inputTokens).toBe(0);
      expect(assistant?.outputTokens).toBe(3);

      const prLinks = await prisma.prLink.findMany();
      expect(prLinks.map((p) => p.prNumber)).toEqual([null]);

      const durations = await prisma.turnDuration.findMany();
      expect(durations.map((d) => Number(d.durationMs))).toEqual([0]);
      expect(durations[0]?.messageCount).toBe(2);
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

    // sess-origin's `continued-in` record names the session that copied it.
    expect(resumed.continuedFromId).toBe("sess-origin");
    // The origin started fresh — no continuation.
    expect(origin.continuedFromId).toBeNull();

    // Both remain DISTINCT rows; tokens are NOT merged.
    expect(origin.tokens.output).toBe(10);
    // The copied Turn still counts in the resumed session's total; #285 will change that.
    expect(resumed.tokens.output).toBe(30);
  });
});
