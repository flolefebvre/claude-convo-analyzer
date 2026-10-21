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
import { getToolCallBody, getTranscript, listConversations } from "@/core/read";
import { readSettings, writeSettings } from "@/core/settings";
import { getLoggedWhatWasSent } from "@/core/what-was-sent";

import { seedEnvironment } from "./environment";
import {
  AGENT_MESSAGES_TITLE,
  CWD_LESS_TITLE,
  FAMILY_WORKTREE_PROJECT_PATH,
  LONG_PAGE_TWO_TEXT,
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

// A full seed is a real ingest of 148 files (~3s); two per test outrun the 5s
// default when the suite runs in parallel.
describe("seedEnvironment", { timeout: 30_000 }, () => {
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
    expect(conversations).toHaveLength(72);
    expect(conversations.reduce((sum, c) => sum + c.subAgentCount, 0)).toBe(87);

    const continued = conversations.filter((c) => c.continuedFromId !== null);
    expect(continued).toHaveLength(5);
    const familyRoots = conversations.filter(
      (c) => c.continuedFromId === null && continued.some((d) => d.continuedFromId === c.id),
    );
    expect(familyRoots).toHaveLength(2);
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
    expect(turns.every((turn) => turn.loggedApiRequestId !== null)).toBe(true);
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
    const sent = await getLoggedWhatWasSent(third.loggedApiRequestId!, { dbPath: seed.dbPath });
    expect(sent?.systemPromptDiff?.isVolatileOnly).toBe(false);
    expect(sent?.toolsDiff?.added.map((tool) => tool.name)).toEqual(["Grep"]);
    // Its new messages: the Turn before it, the injected date change, and the prompt.
    const newMessages = sent?.fullRequest.messages.slice(sent.firstNewMessageIndex);
    expect(newMessages?.map((message) => [message?.role, message?.blocks[0]?.kind])).toEqual([
      ["assistant", "text"],
      ["system", "text"],
      ["user", "text"],
    ]);

    // The first Turn's prompt went out after the CLAUDE.md system-reminder injected into its message.
    const first = view!.messages.find((m) => m.role === "assistant")!;
    const firstSent = await getLoggedWhatWasSent(first.loggedApiRequestId!, { dbPath: seed.dbPath });
    expect(firstSent?.fullRequest.messages[0]?.blocks.map((block) => block.kind)).toEqual(["system-reminder", "text"]);

    // Every message of every Turn's request is rebuilt, from a blob or from the records.
    for (const turn of turns) {
      const turnSent = await getLoggedWhatWasSent(turn.loggedApiRequestId!, { dbPath: seed.dbPath });
      expect(turnSent?.missingMessageCount).toBe(0);
    }
  });

  it("seeds a repo with two worktree Projects, and a /tmp parent with per-session sub-Folders", async () => {
    const seed = await seedEnvironment({ dir: path.join(tmpDir, "seed"), now: NOW });

    const projectPaths = new Set((await listConversations({ dbPath: seed.dbPath })).map((c) => c.project.path));
    const worktreesOfRepo = path.join(os.homedir(), "dev", "acme-api", ".claude", "worktrees");
    expect([...projectPaths].filter((p) => p.startsWith(`${worktreesOfRepo}/`)).sort()).toEqual(
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

    const logs = Object.entries(readTree(seed.logsRoot));
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
    expect(Object.keys(files)).toHaveLength(first.generated.conversations + first.generated.subAgents);
    expect(readTree(second.logsRoot)).toEqual(files);
  });

  it("writes no Recordings: the seed directory holds the logs, the database and the settings", async () => {
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
    expect(await listConversations({ dbPath: after.dbPath })).toHaveLength(72);
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
