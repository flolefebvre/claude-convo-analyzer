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
import { SIDE_REQUEST_KINDS } from "@/core/api-request-kind";
import { getConversation, getTranscript, listConversations } from "@/core/read";
import { discoverRecordings, readRecording, readRecordings, type RecordedApiRequest } from "@/core/recording";
import { readSettings, writeSettings } from "@/core/settings";

import { seedEnvironment } from "./environment";
import {
  AGENT_MESSAGES_TITLE,
  CWD_LESS_TITLE,
  FAMILY_WORKTREE_PROJECT_PATH,
  LONG_PAGE_TWO_TEXT,
  LONG_TITLE,
  PARTIALLY_RECORDED_SESSION_ID,
  RECORDED_SESSION_ID,
  SCRATCH_PARENT_PATH,
  SEED_FAVORITE_PATHS,
  WORKTREE_SWITCH_PROJECT_PATH,
  WORKTREE_SWITCH_TITLE,
} from "./fake-logs";
import {
  FAILED_ATTEMPT_REQUEST_ID,
  OTHER_SIDE_REQUEST_LABEL,
  PARTIALLY_RECORDED_FROM_TURN,
  SIDE_REQUEST_IDS,
  SYSTEM_PROMPT_CHANGE_TURN,
  TOOL_DEFINITION_CHANGE_TURN,
  UNATTRIBUTED_REQUEST_ID,
} from "./fake-recordings";

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
    expect(conversations).toHaveLength(69);
    expect(conversations.reduce((sum, c) => sum + c.subAgentCount, 0)).toBe(83);

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

  it("ingests its Recordings: one Conversation recorded, one partially recorded, every other unrecorded", async () => {
    const seed = await seedEnvironment({ dir: path.join(tmpDir, "seed"), now: NOW });

    const conversations = await listConversations({ dbPath: seed.dbPath });
    const recordedStateBySessionId = new Map(conversations.map((c) => [c.id, c.recordedState]));
    expect(recordedStateBySessionId.get(RECORDED_SESSION_ID)).toBe("recorded");
    expect(recordedStateBySessionId.get(PARTIALLY_RECORDED_SESSION_ID)).toBe("partially-recorded");
    expect(conversations.filter((c) => c.recordedState === "unrecorded")).toHaveLength(conversations.length - 2);
  });

  it("seeds a Conversation that enters a worktree and a cwd-less one, each in the Project it belongs to", async () => {
    const seed = await seedEnvironment({ dir: path.join(tmpDir, "seed"), now: NOW });

    const conversations = await listConversations({ dbPath: seed.dbPath });
    const switching = conversations.find((c) => c.title === WORKTREE_SWITCH_TITLE);
    expect(switching?.project.path).toBe(WORKTREE_SWITCH_PROJECT_PATH);
    const cwdLess = conversations.find((c) => c.title === CWD_LESS_TITLE);
    expect(cwdLess?.project.path).toBe(path.join(os.homedir(), "dev", "acme-api"));
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

  it("ends the seeded activity at the anchor", async () => {
    const seed = await seedEnvironment({ dir: path.join(tmpDir, "seed"), now: NOW });

    const conversations = await listConversations({ dbPath: seed.dbPath });
    const latest = conversations
      .map((c) => c.endedAt)
      .sort()
      .at(-1);
    expect(latest).toBe(NOW.toISOString());
  });

  it("dates each log and Recording file at its latest record, as if written then", async () => {
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

    const recordings = discoverRecordings(seed.recordingsRoot);
    expect(recordings.length).toBeGreaterThan(0);
    for (const recording of recordings) {
      const endedAt = readRecording(recording.sourcePath).map((apiRequest) => Date.parse(apiRequest.timings.endedAt));
      expect({ file: recording.sourcePath, mtime: recording.sourceMtime }).toEqual({
        file: recording.sourcePath,
        mtime: Math.max(...endedAt),
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

  it("records every Turn of the recorded Conversation, its sub-agent's included, as its log has it", async () => {
    const seed = await seedEnvironment({ dir: path.join(tmpDir, "seed"), now: NOW });

    const turns = turnsInLog(seed.logsRoot, RECORDED_SESSION_ID);
    expect(turns.some((turn) => turn.agentId !== null)).toBe(true);
    const apiRequests = readRecordings(seed.recordingsRoot).filter((r) => r.sessionId === RECORDED_SESSION_ID);
    const recordedTurns = turns.map((turn) => {
      const apiRequest = apiRequests.find((r) => r.response.requestId === turn.requestId);
      const body = apiRequest?.response.body as { id?: string; usage?: unknown } | undefined;
      return {
        requestId: apiRequest?.response.requestId,
        agentId: apiRequest?.agentId,
        messageId: body?.id,
        usage: body?.usage,
      };
    });
    expect(recordedTurns).toEqual(turns);
  });

  it("records the partially recorded Conversation only from a later Turn on, repeating the history before it", async () => {
    const seed = await seedEnvironment({ dir: path.join(tmpDir, "seed"), now: NOW });

    const mainTurns = turnsInLog(seed.logsRoot, PARTIALLY_RECORDED_SESSION_ID).filter((t) => t.agentId === null);
    const apiRequests = readRecordings(seed.recordingsRoot).filter(
      (r) => r.sessionId === PARTIALLY_RECORDED_SESSION_ID,
    );
    const isRecorded = mainTurns.map((turn) => apiRequests.some((r) => r.response.requestId === turn.requestId));
    expect(isRecorded).toEqual(mainTurns.map((_, i) => i + 1 >= PARTIALLY_RECORDED_FROM_TURN));

    const firstRecorded = apiRequests.find(
      (r) => r.response.requestId === mainTurns[PARTIALLY_RECORDED_FROM_TURN - 1].requestId,
    );
    const { messages } = firstRecorded?.body as { messages: { role: string }[] };
    expect(messages.filter((m) => m.role === "assistant")).toHaveLength(PARTIALLY_RECORDED_FROM_TURN - 1);
  });

  it("records each kind of Side request on the recorded session, under ids no log record has", async () => {
    const seed = await seedEnvironment({ dir: path.join(tmpDir, "seed"), now: NOW });

    const logs = Object.values(readTree(seed.logsRoot));
    const apiRequests = readRecordings(seed.recordingsRoot);
    const sideRequests = Object.values(SIDE_REQUEST_IDS).map((requestId) =>
      apiRequests.find((r) => r.response.requestId === requestId),
    );
    for (const sideRequest of sideRequests) {
      expect(sideRequest).toMatchObject({ sessionId: RECORDED_SESSION_ID, agentId: null });
      const messageId = (sideRequest?.response.body as { id?: string }).id;
      const ids = [sideRequest?.response.requestId, ...(messageId === undefined ? [] : [messageId])];
      expect(ids.filter((id) => logs.some((log) => log.includes(`"${id}"`)))).toEqual([]);
    }

    const [firstTurn] = turnsInLog(seed.logsRoot, RECORDED_SESSION_ID);
    const turn = apiRequests.find((r) => r.response.requestId === firstTurn.requestId);
    const fingerprints = new Set([turn, ...sideRequests].map((r) => requestFingerprint(r)));
    expect(fingerprints.size).toBe(sideRequests.length + 1);
  });

  it("classifies every kind of Side request on the recorded Conversation, one of each", async () => {
    const seed = await seedEnvironment({ dir: path.join(tmpDir, "seed"), now: NOW });

    const detail = await getConversation(RECORDED_SESSION_ID, { dbPath: seed.dbPath });
    expect(detail?.sideRequests.byKind.map((group) => [group.kind, group.count]).sort()).toEqual(
      [...SIDE_REQUEST_KINDS].sort().map((kind) => [kind, 1]),
    );
    const view = await getTranscript(RECORDED_SESSION_ID, { dbPath: seed.dbPath });
    expect(view?.sideRequests.find((s) => s.kind === "other")?.otherKindLabel).toBe(OTHER_SIDE_REQUEST_LABEL);
  });

  it("records a failed attempt before a Turn, then the retry that succeeds as the Turn", async () => {
    const seed = await seedEnvironment({ dir: path.join(tmpDir, "seed"), now: NOW });

    const apiRequests = readRecordings(seed.recordingsRoot);
    const failedAt = apiRequests.findIndex((r) => r.response.requestId === FAILED_ATTEMPT_REQUEST_ID);
    const failedAttempt = apiRequests[failedAt];
    expect(failedAttempt).toMatchObject({
      sessionId: RECORDED_SESSION_ID,
      agentId: null,
      response: { status: 529, isStreamed: false, body: { type: "error", error: { type: "overloaded_error" } } },
    });
    const retry = apiRequests[failedAt + 1];
    expect(retry.body).toEqual(failedAttempt.body);
    const retriedTurn = turnsInLog(seed.logsRoot, RECORDED_SESSION_ID).find(
      (turn) => turn.requestId === retry.response.requestId,
    );
    expect(retriedTurn?.messageId).toBe((retry.response.body as { id: string }).id);
    expect(Object.values(readTree(seed.logsRoot)).some((log) => log.includes(FAILED_ATTEMPT_REQUEST_ID))).toBe(false);
  });

  it("changes one system block, then one tool definition, between two Turns of the recorded main agent", async () => {
    const seed = await seedEnvironment({ dir: path.join(tmpDir, "seed"), now: NOW });

    const apiRequests = readRecordings(seed.recordingsRoot);
    const bodies = turnsInLog(seed.logsRoot, RECORDED_SESSION_ID)
      .filter((turn) => turn.agentId === null)
      .map((turn) => apiRequests.find((r) => r.response.requestId === turn.requestId)?.body as TurnBody);
    const changedBetween = (ordinal: number, part: "system" | "tools") => {
      const [before, after] = [bodies[ordinal - 2][part], bodies[ordinal - 1][part]];
      return after.filter((piece, i) => JSON.stringify(piece) !== JSON.stringify(before[i])).length;
    };

    expect([
      changedBetween(SYSTEM_PROMPT_CHANGE_TURN, "system"),
      changedBetween(SYSTEM_PROMPT_CHANGE_TURN, "tools"),
    ]).toEqual([1, 0]);
    expect([
      changedBetween(TOOL_DEFINITION_CHANGE_TURN, "system"),
      changedBetween(TOOL_DEFINITION_CHANGE_TURN, "tools"),
    ]).toEqual([0, 1]);
  });

  it("records the two recorded sessions, plus one unattributed API request that matches no Conversation", async () => {
    const seed = await seedEnvironment({ dir: path.join(tmpDir, "seed"), now: NOW });

    const apiRequests = readRecordings(seed.recordingsRoot);
    expect([...new Set(apiRequests.map((r) => r.sessionId))].sort()).toEqual(
      [PARTIALLY_RECORDED_SESSION_ID, RECORDED_SESSION_ID, null].sort(),
    );
    const unattributed = apiRequests.filter((r) => r.sessionId === null);
    expect(unattributed.map((r) => r.response.requestId)).toEqual([UNATTRIBUTED_REQUEST_ID]);
    const messageId = (unattributed[0].response.body as { id: string }).id;
    const logs = Object.values(readTree(seed.logsRoot));
    expect(logs.some((log) => log.includes(`"${UNATTRIBUTED_REQUEST_ID}"`) || log.includes(`"${messageId}"`))).toBe(
      false,
    );
  });

  it("writes byte-identical Recordings for the same anchor", async () => {
    const first = await seedEnvironment({ dir: path.join(tmpDir, "first"), now: NOW });
    const second = await seedEnvironment({ dir: path.join(tmpDir, "second"), now: NOW });

    const files = readTree(first.recordingsRoot, "base64");
    expect(Object.keys(files).length).toBeGreaterThan(0);
    expect(readTree(second.recordingsRoot, "base64")).toEqual(files);
  });

  it("rebuilds from a clean slate, leaving nothing from a previous run", async () => {
    const dir = path.join(tmpDir, "seed");
    const before = await seedEnvironment({ dir, now: NOW });
    const leftover = path.join(before.logsRoot, "-home-dev-stale", "stale-session.jsonl");
    mkdirSync(path.dirname(leftover), { recursive: true });
    writeFileSync(leftover, "{}\n");

    const after = await seedEnvironment({ dir, now: NOW });

    expect(existsSync(leftover)).toBe(false);
    expect(await listConversations({ dbPath: after.dbPath })).toHaveLength(69);
  });
});

/** Every file under `root`, by relative path, with its contents in `encoding`. */
function readTree(root: string, encoding: BufferEncoding = "utf8"): Record<string, string> {
  const files = readdirSync(root, { recursive: true, withFileTypes: true }).filter((e) => e.isFile());
  return Object.fromEntries(
    files.map((e) => {
      const file = path.join(e.parentPath, e.name);
      return [path.relative(root, file), readFileSync(file, encoding)];
    }),
  );
}

/** `file`'s mtime, in whole epoch milliseconds. */
function mtimeOf(file: string): number {
  return Math.floor(statSync(file).mtimeMs);
}

/** What tells API requests apart by their request alone: path, model, `max_tokens`, the opening lines of the system prompt and of the last message. */
function requestFingerprint(apiRequest: RecordedApiRequest | undefined): string {
  const body = apiRequest?.body as
    { model?: string; max_tokens?: number; system?: { text: string }[]; messages?: { content: unknown }[] } | undefined;
  const systemOpening = body?.system?.[0]?.text.split("\n")[0] ?? null;
  const lastContent = body?.messages?.at(-1)?.content;
  const lastText = Array.isArray(lastContent) ? (lastContent as { text?: string }[]).at(-1)?.text : lastContent;
  const lastOpening = typeof lastText === "string" ? lastText.split("\n")[0] : null;
  return JSON.stringify([apiRequest?.path, body?.model, body?.max_tokens ?? null, systemOpening, lastOpening]);
}

/** The parts of a Turn's request body that the Recording stores as pieces. */
type TurnBody = { system: unknown[]; tools: unknown[] };

/** A Turn as a log has it: the ids an API request is joined on, and its usage. */
type LoggedTurn = { requestId: string; agentId: string | null; messageId: string; usage: unknown };

/** Every Turn in the logs of `sessionId`, its main agent's then each sub-agent's, in log order. */
function turnsInLog(logsRoot: string, sessionId: string): LoggedTurn[] {
  const logFiles = Object.entries(readTree(logsRoot))
    .filter(([file]) => path.basename(file) === `${sessionId}.jsonl` || file.includes(`/${sessionId}/subagents/`))
    .sort(([a], [b]) => a.length - b.length || a.localeCompare(b));
  return logFiles.flatMap(([, text]) =>
    text
      .split("\n")
      .filter((line) => line !== "")
      .map((line) => JSON.parse(line))
      .filter((record) => record.type === "assistant")
      .map((record) => ({
        requestId: record.requestId,
        agentId: record.agentId ?? null,
        messageId: record.message.id,
        usage: record.message.usage,
      })),
  );
}
