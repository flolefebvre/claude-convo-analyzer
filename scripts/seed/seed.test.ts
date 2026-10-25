import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import os, { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { PAGE_SIZE } from "@/app/_lib/list-view";
import { DEFAULT_SORT, sortConversations } from "@/app/_lib/sort";
import { type TranscriptMessage, getToolCallBody, getTranscript, listConversations } from "@/core/read";
import { readSettings, writeSettings } from "@/core/settings";
import { getWhatWasSent } from "@/core/what-was-sent";

import { seedEnvironment } from "./environment";
import {
  AGENT_MESSAGES_TITLE,
  CWD_LESS_TITLE,
  FAMILY_WORKTREE_PROJECT_PATH,
  FORKED_AGENTS_TITLE,
  LONG_PAGE_TWO_TEXT,
  LOGGED_REQUESTS_CONTINUATION_TITLE,
  LOGGED_REQUESTS_SUB_AGENT_THINKING_TEXT,
  LOGGED_REQUESTS_THINKING_TEXT,
  LOGGED_REQUESTS_TITLE,
  LONG_TITLE,
  PLAN_HANDOFF_TITLE,
  SCRATCH_PARENT_PATH,
  SEED_FAVORITE_PATHS,
  UNTITLED_SESSION_ID,
  WORKTREE_SWITCH_PROJECT_PATH,
  WORKTREE_SWITCH_TITLE,
} from "./fake-logs";

const NOW = new Date("2026-06-22T17:00:00.000Z");
// The seeded two-sitting chain: its continuation links to the first sitting's Sub-agents (`continuationFamilies`).
const CHAIN_START_TITLE = "Make the nightly export idempotent";
const CHAIN_END_TITLE = "Nightly export — finish the retry path";

describe("seedEnvironment", () => {
  let tmpDir = "";

  beforeEach(() => {
    tmpDir = mkdtempSync(path.join(tmpdir(), "cca-seed-test-"));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("ingests every seeded Conversation, sub-agent and continuation family without a malformed line", async () => {
    const seed = await seedEnvironment({ dir: path.join(tmpDir, "seed"), now: NOW });

    expect(seed.summary.malformedLinesSkipped).toBe(0);
    expect(seed.summary.duplicateSessionsSkipped).toEqual([]);

    const conversations = await listConversations({ dbPath: seed.dbPath });
    expect(conversations).toHaveLength(74);
    // Each Sub-agent counted under every Conversation holding it, a continuation's links included.
    expect(conversations.reduce((sum, c) => sum + c.subAgentCount, 0)).toBe(
      seed.generated.subAgents + seed.generated.linkedSubAgents,
    );

    const continued = conversations.filter((c) => c.continuedFromId !== null);
    expect(continued).toHaveLength(6);
    const familyRoots = conversations.filter(
      (c) => c.continuedFromId === null && continued.some((d) => d.continuedFromId === c.id),
    );
    expect(familyRoots).toHaveLength(3);
  });

  it("keeps its own settings file inside the seed, reset to Live off and the seeded favorites after each re-seed", async () => {
    const seedDir = path.join(tmpDir, "seed");
    const firstSeed = await seedEnvironment({ dir: seedDir, now: NOW });
    expect(path.dirname(firstSeed.settingsPath)).toBe(seedDir);
    await writeSettings({ live: true, favorites: [] }, firstSeed.settingsPath);

    const reseed = await seedEnvironment({ dir: seedDir, now: NOW });

    await expect(readSettings(reseed.settingsPath)).resolves.toEqual({
      live: false,
      favorites: [...SEED_FAVORITE_PATHS],
    });
  });

  it("favorites three seeded Projects", async () => {
    const seed = await seedEnvironment({ dir: path.join(tmpDir, "seed"), now: NOW });
    const projectPaths = new Set((await listConversations({ dbPath: seed.dbPath })).map((c) => c.project.path));

    expect(SEED_FAVORITE_PATHS).toHaveLength(3);
    for (const favoritePath of SEED_FAVORITE_PATHS) expect(projectPaths).toContain(favoritePath);
  });

  it("seeds a Conversation that enters a worktree and a cwd-less one, each in the Project it belongs to", async () => {
    const seed = await seedEnvironment({ dir: path.join(tmpDir, "seed"), now: NOW });

    const conversations = await listConversations({ dbPath: seed.dbPath });
    const switching = conversations.find((c) => c.title === WORKTREE_SWITCH_TITLE);
    expect(switching?.project.path).toBe(WORKTREE_SWITCH_PROJECT_PATH);
    const cwdLess = conversations.find((c) => c.title === CWD_LESS_TITLE);
    expect(cwdLess?.project.path).toBe(path.join(os.homedir(), "dev", "acme-api"));
  });

  it("seeds one untitled Conversation, on the list's first page", async () => {
    const seed = await seedEnvironment({ dir: path.join(tmpDir, "seed"), now: NOW });

    const conversations = await listConversations({ dbPath: seed.dbPath });
    expect(conversations.filter((c) => c.title === null).map((c) => c.id)).toEqual([UNTITLED_SESSION_ID]);
    const firstPage = sortConversations(conversations, DEFAULT_SORT).slice(0, PAGE_SIZE);
    expect(firstPage.map((c) => c.id)).toContain(UNTITLED_SESSION_ID);
  });

  it("seeds a Conversation whose every Turn, its Sub-agent's included, shows What was sent from its logs", async () => {
    const seed = await seedEnvironment({ dir: path.join(tmpDir, "seed"), now: NOW });

    const conversations = await listConversations({ dbPath: seed.dbPath });
    const logged = conversations.find((c) => c.title === LOGGED_REQUESTS_TITLE);
    // On the list's first page, where the e2e spec opens it.
    expect(sortConversations(conversations, DEFAULT_SORT).slice(0, PAGE_SIZE)).toContain(logged);
    const view = await getTranscript(logged!.id, { dbPath: seed.dbPath });
    const subAgent = view?.tree.children.find((node) => node.agentType === "Explore");
    const subAgentView = await getTranscript(logged!.id, { dbPath: seed.dbPath, agentId: subAgent?.id });
    const turns = [...(view?.messages ?? []), ...(subAgentView?.messages ?? [])].filter((m) => m.role === "assistant");
    expect(turns.every((turn) => turn.apiRequestId !== null)).toBe(true);
    expect(turns).toHaveLength(6);
    // The second Main-thread Turn went through on a retry, after one Failed attempt.
    expect(turns.map((turn) => [turn.failedAttemptCount, turn.failedAttemptsLostMs])).toEqual([
      [0, null],
      [1, 300],
      [0, null],
      [0, null],
      [0, null],
      [0, null],
    ]);

    // The third Main-thread Turn: the system prompt and the tools changed since the second.
    const third = view!.messages.filter((m) => m.role === "assistant")[2]!;
    const sent = await getWhatWasSent(third.apiRequestId!, { dbPath: seed.dbPath });
    expect(sent?.systemPromptDiff?.isVolatileOnly).toBe(false);
    expect(sent?.toolsDiff?.added.map((tool) => tool.name)).toEqual(["Grep"]);
    // Its new messages: the Turn before it, the injected date change, and the prompt.
    const newMessages = sent?.fullRequest.messages.slice(sent.firstNewMessageIndex);
    expect(newMessages?.map((message) => [message?.role, message?.parts[0]?.label])).toEqual([
      ["assistant", "Assistant text"],
      ["system", "Date"],
      ["user", "Prompt"],
    ]);

    // The first Turn: a system message fusing three pieces of context, then the
    // prompt after the CLAUDE.md and AGENTS.md system-reminder injected into its message.
    const first = view!.messages.find((m) => m.role === "assistant")!;
    const firstSent = await getWhatWasSent(first.apiRequestId!, { dbPath: seed.dbPath });
    expect(firstSent?.fullRequest.messages.map((message) => message?.parts.map((part) => part.label))).toEqual([
      ["Environment", "Skill list", "Date"],
      ["CLAUDE.md · AGENTS.md", "Prompt"],
    ]);

    // The Sub-agent's first Turn: the skill list its own transcript names.
    const subAgentFirst = subAgentView!.messages.find((m) => m.role === "assistant")!;
    const subAgentFirstSent = await getWhatWasSent(subAgentFirst.apiRequestId!, { dbPath: seed.dbPath });
    expect(subAgentFirstSent?.fullRequest.messages.map((message) => message?.parts[0]?.label)).toEqual([
      "Skill list",
      "Prompt",
    ]);

    // Every message of every Turn's request is rebuilt, from a blob or from the records.
    for (const turn of turns) {
      const turnSent = await getWhatWasSent(turn.apiRequestId!, { dbPath: seed.dbPath });
      expect(turnSent?.missingMessageCount).toBe(0);
    }
  });

  it("seeds a continuation of it whose copied Turns name the API requests their owner's log holds", async () => {
    const seed = await seedEnvironment({ dir: path.join(tmpDir, "seed"), now: NOW });

    const conversations = await listConversations({ dbPath: seed.dbPath });
    const [logged, continuation] = [LOGGED_REQUESTS_TITLE, LOGGED_REQUESTS_CONTINUATION_TITLE].map((title) =>
      conversations.find((c) => c.title === title),
    );
    expect(continuation?.continuedFromId).toBe(logged?.id);
    // On the list's first page, where the e2e spec opens it.
    expect(sortConversations(conversations, DEFAULT_SORT).slice(0, PAGE_SIZE)).toContain(continuation);
    const view = await getTranscript(continuation!.id, { dbPath: seed.dbPath });
    const copiedTurns = view!.messages.filter((m) => m.role === "assistant" && m.isCopied);
    expect(copiedTurns).toHaveLength(4);
    expect(copiedTurns.every((turn) => turn.apiRequestId !== null && turn.copiedFrom?.sessionId === logged?.id)).toBe(
      true,
    );
  });

  it("seeds Turns that thought, with a summary and without, on the Main thread and in a Sub-agent", async () => {
    const seed = await seedEnvironment({ dir: path.join(tmpDir, "seed"), now: NOW });

    const logged = (await listConversations({ dbPath: seed.dbPath })).find((c) => c.title === LOGGED_REQUESTS_TITLE);
    const mainThread = await getTranscript(logged!.id, { dbPath: seed.dbPath });
    const explore = mainThread?.tree.children.find((node) => node.agentType === "Explore");
    const subAgent = await getTranscript(logged!.id, { dbPath: seed.dbPath, agentId: explore?.id });
    const thinkingOf = (messages: TranscriptMessage[] = []) =>
      messages.filter((m) => m.role === "assistant").map((m) => [m.thinkingText, m.thinkingDurationMs]);
    expect(thinkingOf(mainThread?.messages)).toEqual([
      [LOGGED_REQUESTS_THINKING_TEXT, 1_300],
      [null, null],
      [null, 600],
      [null, null],
    ]);
    expect(thinkingOf(subAgent?.messages)).toEqual([
      [LOGGED_REQUESTS_SUB_AGENT_THINKING_TEXT, 2_400],
      [null, 450],
    ]);
  });

  it("seeds a repo with two worktree Projects, and a /tmp parent with per-session sub-Folders", async () => {
    const seed = await seedEnvironment({ dir: path.join(tmpDir, "seed"), now: NOW });

    const projectPaths = new Set((await listConversations({ dbPath: seed.dbPath })).map((c) => c.project.path));
    const worktreesOfRepo = path.join(os.homedir(), "dev", "acme-api", ".claude", "worktrees");
    expect([...projectPaths].filter((p) => p.startsWith(`${worktreesOfRepo}${path.sep}`)).sort()).toEqual(
      [FAMILY_WORKTREE_PROJECT_PATH, WORKTREE_SWITCH_PROJECT_PATH].sort(),
    );
    expect([...projectPaths].filter((p) => p.startsWith(`${SCRATCH_PARENT_PATH}/`))).toHaveLength(3);
  });

  it("seeds a second page of Conversations, one with unpriced usage and another with API errors", async () => {
    const seed = await seedEnvironment({ dir: path.join(tmpDir, "seed"), now: NOW });

    const conversations = await listConversations({ dbPath: seed.dbPath });
    expect(conversations.length).toBeGreaterThan(PAGE_SIZE);

    const unpriced = conversations.find((c) => c.title === "Investigate a model the price table does not know");
    expect(unpriced).toMatchObject({ unpriced: true, errorCount: 0 });
    expect(unpriced?.costUsd).toBeGreaterThan(0);

    const failing = conversations.find((c) => c.title === "Finish the release while the API keeps failing");
    expect(failing).toMatchObject({ unpriced: false });
    expect(failing?.errorCount).toBeGreaterThan(0);
  });

  it("seeds a Conversation where agents message each other, with every user Message shape", async () => {
    const seed = await seedEnvironment({ dir: path.join(tmpDir, "seed"), now: NOW });

    const convo = (await listConversations({ dbPath: seed.dbPath })).find((c) => c.title === AGENT_MESSAGES_TITLE);
    expect(convo).toBeDefined();
    const main = await getTranscript(convo?.id ?? "", { dbPath: seed.dbPath });
    const user = main?.messages.filter((m) => m.role === "user") ?? [];
    const subIds = main?.tree.children.map((c) => c.id) ?? [];

    const interAgent = user.filter((m) => m.kind === "inter-agent");
    expect(interAgent.some((m) => m.origin?.senderAgentId === subIds[0] && !m.origin.handback)).toBe(true);
    expect(interAgent.some((m) => m.origin?.handback && m.origin.senderAgentId === subIds[0])).toBe(true);
    expect(interAgent.some((m) => m.origin?.senderAgentId === null && m.origin.midTurn)).toBe(true);

    const notifications = user.filter((m) => m.kind === "task-notification");
    expect(notifications.map((m) => m.origin?.taskStatus)).toEqual(["completed", "failed", "stopped"]);
    expect(notifications.map((m) => m.origin?.taskAgentId)).toEqual([subIds[0], null, subIds[1]]);

    const prompts = user.filter((m) => m.kind === "prompt");
    expect(prompts.some((m) => m.origin?.plugin === "session-history")).toBe(true);
    expect(prompts.some((m) => m.origin?.midTurn)).toBe(true);

    const worker = await getTranscript(convo?.id ?? "", { dbPath: seed.dbPath, agentId: subIds[0] });
    const coordinator = worker?.messages.filter((m) => m.origin?.coordinator) ?? [];
    expect(coordinator).toHaveLength(2);
    expect(coordinator.every((m) => m.origin?.senderAgentId === main?.tree.id && m.origin?.midTurn)).toBe(true);
  });

  it("seeds a Sub-agent forking twice from one Turn and a Main-thread fork, each fork under its spawner, copying it", async () => {
    const seed = await seedEnvironment({ dir: path.join(tmpDir, "seed"), now: NOW });

    const conversations = await listConversations({ dbPath: seed.dbPath });
    const convo = conversations.find((c) => c.title === FORKED_AGENTS_TITLE);
    // On the list's first page, where the e2e specs open it.
    expect(sortConversations(conversations, DEFAULT_SORT).slice(0, PAGE_SIZE)).toContain(convo);
    const main = await getTranscript(convo!.id, { dbPath: seed.dbPath });
    expect(main?.tree.children.map((node) => node.agentType)).toEqual(["general-purpose", "fork"]);
    const [lead, mainThreadFork] = main!.tree.children;
    expect(lead?.children.map((node) => node.agentType)).toEqual(["fork", "fork"]);

    for (const fork of lead!.children) {
      const forkView = await getTranscript(convo!.id, { dbPath: seed.dbPath, agentId: fork.id });
      const copied = forkView!.messages.filter((m) => m.copiedFrom !== null);
      const own = forkView!.messages.filter((m) => m.copiedFrom === null && m.role === "assistant");
      // The lead's prompt and first Turn, then its spawning Turn re-written.
      expect(copied.map((m) => [m.role, m.copiedFrom?.agentId])).toEqual([
        ["user", lead!.id],
        ["assistant", lead!.id],
        ["assistant", lead!.id],
      ]);
      expect(own.length).toBeGreaterThan(0);
      expect(own.every((m) => m.costUsd > 0)).toBe(true);
    }
    const mainThreadForkView = await getTranscript(convo!.id, { dbPath: seed.dbPath, agentId: mainThreadFork!.id });
    expect(mainThreadForkView!.messages.filter((m) => m.copiedFrom !== null).map((m) => m.copiedFrom?.agentId)).toEqual(
      [null],
    );
  });

  it("seeds a background Sub-agent whose type only its meta file states", async () => {
    const seed = await seedEnvironment({ dir: path.join(tmpDir, "seed"), now: NOW });

    const convo = (await listConversations({ dbPath: seed.dbPath })).find((c) => c.title === AGENT_MESSAGES_TITLE);
    const main = await getTranscript(convo?.id ?? "", { dbPath: seed.dbPath });
    const worker = main?.tree.children[0];
    const spawn = main?.messages.flatMap((m) => m.toolCalls).find((tc) => tc.toolUseId === worker?.spawnedByToolUseId);
    const spawnBody = await getToolCallBody(spawn?.id ?? -1, { dbPath: seed.dbPath });

    expect(spawnBody?.resultText).toContain('"status":"async_launched"');
    expect(spawnBody?.resultText).not.toContain('"agentType"');
    expect(worker?.agentType).toMatch(/.+/);
  });

  it("writes a meta file beside each Sub-agent transcript and each link to one, dated at its spawn", async () => {
    const seed = await seedEnvironment({ dir: path.join(tmpDir, "seed"), now: NOW });

    const metaFiles = Object.entries(readTree(seed.logsRoot)).filter(([file]) => file.endsWith(".meta.json"));
    expect(metaFiles).toHaveLength(seed.generated.subAgents + seed.generated.linkedSubAgents);
    for (const [file, text] of metaFiles) {
      const transcript = readFileSync(path.join(seed.logsRoot, file.replace(/\.meta\.json$/, ".jsonl")), "utf8");
      // A Main-thread fork's transcript opens with a `fork-context-ref`, which has no timestamp.
      const firstTimestamp = transcript
        .split("\n")
        .filter((line) => line !== "")
        .map((line) => (JSON.parse(line) as { timestamp?: string }).timestamp)
        .find((timestamp) => timestamp !== undefined)!;
      expect(JSON.parse(text)).toMatchObject({ agentType: expect.any(String), toolUseId: expect.any(String) });
      expect({ file, mtime: mtimeOf(path.join(seed.logsRoot, file)) }).toEqual({
        file,
        mtime: Date.parse(firstTimestamp),
      });
    }
  });

  it("links each continuation to its parent's Sub-agent transcripts, every Message of them copied", async () => {
    const seed = await seedEnvironment({ dir: path.join(tmpDir, "seed"), now: NOW });

    const conversations = await listConversations({ dbPath: seed.dbPath });
    const idOf = (title: string) => conversations.find((c) => c.title === title)?.id ?? "";
    const parent = await getTranscript(idOf(CHAIN_START_TITLE), { dbPath: seed.dbPath });
    const continuation = await getTranscript(idOf(CHAIN_END_TITLE), { dbPath: seed.dbPath });
    const parentAgentIds = parent?.tree.children.map((child) => child.id) ?? [];

    expect(seed.generated.linkedSubAgents).toBe(5);
    expect(parentAgentIds.length).toBeGreaterThan(0);
    const continuationAgentIds = continuation?.tree.children.map((child) => child.id) ?? [];
    expect(continuationAgentIds).toEqual(expect.arrayContaining(parentAgentIds));
    for (const agentId of parentAgentIds) {
      const linked = await getTranscript(idOf(CHAIN_END_TITLE), { dbPath: seed.dbPath, agentId, page: "all" });
      expect(linked?.messages.length).toBeGreaterThan(0);
      expect(linked?.messages.every((m) => m.isCopied)).toBe(true);
    }
  });

  it("seeds a Conversation whose main agent spans three Transcript pages, a known prompt on the second", async () => {
    const seed = await seedEnvironment({ dir: path.join(tmpDir, "seed"), now: NOW });

    const convo = (await listConversations({ dbPath: seed.dbPath })).find((c) => c.title === LONG_TITLE);
    expect(convo).toBeDefined();
    const first = await getTranscript(convo?.id ?? "", { dbPath: seed.dbPath });
    expect(first?.pageCount).toBe(3);
    expect(first?.messages.some((m) => m.text === LONG_PAGE_TWO_TEXT)).toBe(false);
    const second = await getTranscript(convo?.id ?? "", { dbPath: seed.dbPath, page: 2 });
    expect(second?.messages.some((m) => m.text === LONG_PAGE_TWO_TEXT)).toBe(true);
  });

  it("seeds an ExitPlanMode call and a SendMessage call whose stored JSON receipt reads as facts", async () => {
    const seed = await seedEnvironment({ dir: path.join(tmpDir, "seed"), now: NOW });

    const convo = (await listConversations({ dbPath: seed.dbPath })).find((c) => c.title === PLAN_HANDOFF_TITLE);
    expect(convo).toBeDefined();
    const transcript = await getTranscript(convo?.id ?? "", { dbPath: seed.dbPath });
    const calls = transcript?.messages.flatMap((m) => m.toolCalls) ?? [];
    expect(calls.map((c) => c.name)).toEqual(["ExitPlanMode", "SendMessage"]);
    const [plan, send] = await Promise.all(calls.map((c) => getToolCallBody(c.id, { dbPath: seed.dbPath })));

    expect(plan?.inputParts.map((p) => p.kind)).toEqual(["markdown"]);
    expect(plan?.resultParts).toEqual([{ kind: "raw" }]);
    expect(send?.inputParts.map((p) => p.kind)).toEqual(["facts", "markdown"]);
    expect(JSON.parse(send?.resultText ?? "")).toMatchObject({ success: true, message: expect.any(String) });
    expect(send?.resultParts?.map((p) => p.kind)).toEqual(["facts"]);
  });

  it("ends the seeded activity at the anchor", async () => {
    const seed = await seedEnvironment({ dir: path.join(tmpDir, "seed"), now: NOW });

    const conversations = await listConversations({ dbPath: seed.dbPath });
    const latest = conversations
      .map((c) => c.endedAt)
      .sort()
      .at(-1);
    expect(latest).toBe(NOW.toISOString());
  });

  it("dates each log file at its latest record, as if written then", async () => {
    const seed = await seedEnvironment({ dir: path.join(tmpDir, "seed"), now: NOW });

    const logs = Object.entries(readTree(seed.logsRoot)).filter(([file]) => file.endsWith(".jsonl"));
    expect(logs).toHaveLength(seed.generated.conversations + seed.generated.subAgents);
    for (const [file, text] of logs) {
      const timestamps = text
        .split("\n")
        .filter((line) => line !== "")
        .map((line) => (JSON.parse(line) as { timestamp?: string }).timestamp)
        .filter((timestamp) => timestamp !== undefined)
        .map((timestamp) => Date.parse(timestamp));
      expect({ file, mtime: mtimeOf(path.join(seed.logsRoot, file)) }).toEqual({
        file,
        mtime: Math.max(...timestamps),
      });
    }
  });

  it("writes byte-identical logs for the same anchor", async () => {
    const first = await seedEnvironment({ dir: path.join(tmpDir, "first"), now: NOW });
    const second = await seedEnvironment({ dir: path.join(tmpDir, "second"), now: NOW });

    const files = readTree(first.logsRoot);
    // A log per Conversation and per Sub-agent, and a meta file beside each Sub-agent's log and each link to one.
    expect(Object.keys(files)).toHaveLength(
      first.generated.conversations + 2 * first.generated.subAgents + first.generated.linkedSubAgents,
    );
    expect(readTree(second.logsRoot)).toEqual(files);
  });

  it("leaves the seed directory holding only the logs, the database and the settings", async () => {
    const dir = path.join(tmpDir, "seed");
    await seedEnvironment({ dir, now: NOW });

    expect(
      readdirSync(dir)
        .filter((name) => !name.startsWith("seed.db"))
        .sort(),
    ).toEqual(["projects", "settings.json"]);
  });

  it("rebuilds from a clean slate, leaving nothing from a previous run", async () => {
    const dir = path.join(tmpDir, "seed");
    const before = await seedEnvironment({ dir, now: NOW });
    const leftover = path.join(before.logsRoot, "-home-dev-stale", "stale-session.jsonl");
    mkdirSync(path.dirname(leftover), { recursive: true });
    writeFileSync(leftover, "{}\n");

    const after = await seedEnvironment({ dir, now: NOW });

    expect(existsSync(leftover)).toBe(false);
    expect(await listConversations({ dbPath: after.dbPath })).toHaveLength(74);
  });
});

/** Every file under `root`, by relative path, with its contents as UTF-8. */
function readTree(root: string): Record<string, string> {
  const files = readdirSync(root, { recursive: true, withFileTypes: true }).filter((e) => e.isFile());
  return Object.fromEntries(
    files.map((e) => {
      const file = path.join(e.parentPath, e.name);
      return [path.relative(root, file), readFileSync(file, "utf8")];
    }),
  );
}

/** `file`'s mtime, in whole epoch milliseconds. */
function mtimeOf(file: string): number {
  return Math.floor(statSync(file).mtimeMs);
}
