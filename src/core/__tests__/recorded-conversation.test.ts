// Recorded Conversations (GLOSSARY.md, Recorded): a Refresh joins each API
// request of a Recording to its Conversation and, when it is one, to its Turn
// — by `requestId`, else by `message.id`, in the Main thread or a sub-agent —
// and the list says whether every Turn, some, or none have an API request. A
// Failed attempt joins the Turn whose API request retried it. The Recording
// only ever adds: Turn usage and Cost stay the transcript's.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { type ConversationSummary, getConversation, getTranscript, listConversations } from "@/core/read";
import { openRecordingWriter, type RecordedApiRequest } from "@/core/recording";
import { refresh } from "@/core/refresh";

const LOGS_ROOT = path.join(import.meta.dirname, "fixtures", "recorded-logs");
const MAIN_SESSION_ID = "sess-rec-main";
const OTHER_SESSION_ID = "sess-rec-other";

/** The Turns of the main fixture Conversation: two of its Main thread, one of its sub-agent `rsub1`. */
const MAIN_THREAD_TURNS = [
  { requestId: "rreq-1", messageId: "rmsg-1" },
  { requestId: "rreq-2", messageId: "rmsg-2" },
];
const SUB_AGENT_TURN = { requestId: "rreq-3", messageId: "rmsg-3", agentId: "rsub1" };

let tmpDir: string;
let recordingsRoot: string;
let dbPath: string;

beforeEach(() => {
  tmpDir = mkdtempSync(path.join(tmpdir(), "cca-recorded-"));
  recordingsRoot = path.join(tmpDir, "recordings");
  dbPath = path.join(tmpDir, "analyzer.db");
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

/** The API request of one Turn, as the Recorder keeps it; `requestId`/`messageId` null when the response lacked it. */
function turnApiRequest(opts: {
  sessionId: string;
  requestId: string | null;
  messageId: string | null;
  agentId?: string | null;
}): RecordedApiRequest {
  return {
    sessionId: opts.sessionId,
    agentId: opts.agentId ?? null,
    method: "POST",
    path: "/v1/messages",
    query: "beta=true",
    headers: { "anthropic-version": "2023-06-01" },
    // Each Turn sends its own history, so no two Turns send the same body.
    body: {
      model: "claude-opus-4-8",
      max_tokens: 32000,
      messages: [{ role: "user", content: `audit the exports, until ${opts.requestId ?? opts.messageId}` }],
    },
    response: {
      status: 200,
      requestId: opts.requestId,
      headers: opts.requestId === null ? {} : { "request-id": opts.requestId },
      body: opts.messageId === null ? null : { id: opts.messageId, type: "message", content: [] },
      isStreamed: true,
    },
    timings: {
      arrivedAt: "2026-10-18T10:00:00.000Z",
      firstByteAt: "2026-10-18T10:00:01.000Z",
      endedAt: "2026-10-18T10:00:02.000Z",
    },
  };
}

/**
 * A failed attempt of `retry`: the same request from the same Agent, turned
 * away as overloaded `secondsBefore` seconds before it, under a `request-id`
 * no log has. `agentId` overrides the Agent header it was sent with.
 */
function failedAttemptOf(
  retry: RecordedApiRequest,
  opts: { requestId: string; secondsBefore: number; agentId?: string | null },
): RecordedApiRequest {
  const arrivedMs = Date.parse(retry.timings.arrivedAt) - opts.secondsBefore * 1000;
  return {
    ...retry,
    agentId: opts.agentId === undefined ? retry.agentId : opts.agentId,
    response: {
      status: 529,
      requestId: opts.requestId,
      headers: { "request-id": opts.requestId },
      body: { type: "error", error: { type: "overloaded_error", message: "Overloaded" } },
      isStreamed: false,
    },
    timings: {
      arrivedAt: new Date(arrivedMs).toISOString(),
      firstByteAt: new Date(arrivedMs + 400).toISOString(),
      endedAt: new Date(arrivedMs + 500).toISOString(),
    },
  };
}

/** Append `apiRequests` to the Recordings under the test's root. */
async function record(apiRequests: RecordedApiRequest[]): Promise<void> {
  const writer = openRecordingWriter(recordingsRoot);
  for (const apiRequest of apiRequests) await writer.append(apiRequest);
}

/** Every Turn of the main fixture Conversation, recorded with its `request-id` and `message.id`. */
function everyMainTurn(): RecordedApiRequest[] {
  return [...MAIN_THREAD_TURNS, SUB_AGENT_TURN].map((turn) => turnApiRequest({ sessionId: MAIN_SESSION_ID, ...turn }));
}

/** Refresh the fixture logs with the test's Recordings, then list the Conversations by session id. */
async function refreshAndList(): Promise<Map<string, ConversationSummary>> {
  await refresh({ logsRoot: LOGS_ROOT, dbPath, recordingsRoot });
  return new Map((await listConversations({ dbPath })).map((summary) => [summary.id, summary]));
}

describe("a Recorded Conversation", () => {
  it("is unrecorded when no Recording has its session", async () => {
    const summaries = await refreshAndList();

    expect(summaries.get(MAIN_SESSION_ID)?.recordedState).toBe("unrecorded");
    expect(summaries.get(OTHER_SESSION_ID)?.recordedState).toBe("unrecorded");
  });

  it("is recorded when every Turn, the sub-agent's included, matches an API request by requestId", async () => {
    await record(
      everyMainTurn().map((apiRequest) => ({ ...apiRequest, response: { ...apiRequest.response, body: null } })),
    );

    const summaries = await refreshAndList();

    expect(summaries.get(MAIN_SESSION_ID)?.recordedState).toBe("recorded");
    expect(summaries.get(OTHER_SESSION_ID)?.recordedState).toBe("unrecorded");
  });

  it("matches a Turn by message.id when the API request has no requestId", async () => {
    await record(
      [...MAIN_THREAD_TURNS, SUB_AGENT_TURN].map((turn) =>
        turnApiRequest({ sessionId: MAIN_SESSION_ID, requestId: null, messageId: turn.messageId }),
      ),
    );

    expect((await refreshAndList()).get(MAIN_SESSION_ID)?.recordedState).toBe("recorded");
  });

  it("matches a Turn by message.id when its requestId matches no Turn", async () => {
    await record(
      [...MAIN_THREAD_TURNS, SUB_AGENT_TURN].map((turn) =>
        turnApiRequest({ sessionId: MAIN_SESSION_ID, requestId: `other-${turn.requestId}`, messageId: turn.messageId }),
      ),
    );

    expect((await refreshAndList()).get(MAIN_SESSION_ID)?.recordedState).toBe("recorded");
  });

  it("is partially recorded when the sub-agent's Turn has no API request", async () => {
    await record(MAIN_THREAD_TURNS.map((turn) => turnApiRequest({ sessionId: MAIN_SESSION_ID, ...turn })));

    expect((await refreshAndList()).get(MAIN_SESSION_ID)?.recordedState).toBe("partially-recorded");
  });

  it("is partially recorded when only some Main-thread Turns have an API request", async () => {
    await record([turnApiRequest({ sessionId: MAIN_SESSION_ID, ...MAIN_THREAD_TURNS[1] })]);

    expect((await refreshAndList()).get(MAIN_SESSION_ID)?.recordedState).toBe("partially-recorded");
  });

  it("counts only the Turns the API answered: a <synthetic> Message never needs an API request", async () => {
    // The fixture's `rsyn-1` is a `<synthetic>` assistant Message, written by
    // Claude Code itself: every other Turn recorded is the whole Conversation.
    await record(everyMainTurn());

    expect((await refreshAndList()).get(MAIN_SESSION_ID)?.recordedState).toBe("recorded");
  });

  it("stays unrecorded when its API requests match no Turn", async () => {
    await record([turnApiRequest({ sessionId: MAIN_SESSION_ID, requestId: "req-side", messageId: "msg-side" })]);

    expect((await refreshAndList()).get(MAIN_SESSION_ID)?.recordedState).toBe("unrecorded");
  });

  it("stays recorded when two API requests match the same Turn", async () => {
    await record([...everyMainTurn(), turnApiRequest({ sessionId: MAIN_SESSION_ID, ...MAIN_THREAD_TURNS[0] })]);

    expect((await refreshAndList()).get(MAIN_SESSION_ID)?.recordedState).toBe("recorded");
  });

  it("ignores an API request whose session has no Conversation, and the unattributed ones", async () => {
    await record([
      turnApiRequest({ sessionId: "sess-not-on-disk", ...MAIN_THREAD_TURNS[0] }),
      turnApiRequest({ sessionId: null as unknown as string, ...MAIN_THREAD_TURNS[1] }),
    ]);

    const summaries = await refreshAndList();

    expect([...summaries.keys()].sort()).toEqual([MAIN_SESSION_ID, OTHER_SESSION_ID]);
    expect(summaries.get(MAIN_SESSION_ID)?.recordedState).toBe("unrecorded");
  });

  it("says the same on the Conversation's own detail", async () => {
    await record(MAIN_THREAD_TURNS.map((turn) => turnApiRequest({ sessionId: MAIN_SESSION_ID, ...turn })));
    await refresh({ logsRoot: LOGS_ROOT, dbPath, recordingsRoot });

    expect((await getConversation(MAIN_SESSION_ID, { dbPath }))?.recordedState).toBe("partially-recorded");
  });
});

/** How many failed attempts each assistant Turn of one Agent's transcript has (`agentId` undefined: the Main thread). */
async function failedAttemptCountsOf(agentId?: string): Promise<number[]> {
  const view = await getTranscript(MAIN_SESSION_ID, { dbPath, agentId });
  return (view?.messages ?? [])
    .filter((message) => message.role === "assistant" && message.model !== "<synthetic>")
    .map((message) => message.failedAttemptCount);
}

describe("a failed attempt", () => {
  it("belongs to the Turn whose API request retried it", async () => {
    const [first, second] = everyMainTurn();
    await record([first, failedAttemptOf(second, { requestId: "req-overloaded", secondsBefore: 3 }), second]);
    await refresh({ logsRoot: LOGS_ROOT, dbPath, recordingsRoot });

    expect(await failedAttemptCountsOf()).toEqual([0, 1]);
  });

  it("belongs to its own Agent's Turn when two Agents retry around the same time", async () => {
    const [first, , subAgentTurn] = everyMainTurn();
    await record([
      failedAttemptOf(first, { requestId: "req-main-overloaded", secondsBefore: 2 }),
      failedAttemptOf(subAgentTurn, { requestId: "req-sub-overloaded-1", secondsBefore: 2 }),
      failedAttemptOf(subAgentTurn, { requestId: "req-sub-overloaded-2", secondsBefore: 1 }),
      first,
      subAgentTurn,
    ]);
    await refresh({ logsRoot: LOGS_ROOT, dbPath, recordingsRoot });

    expect(await failedAttemptCountsOf()).toEqual([1, 0]);
    expect(await failedAttemptCountsOf(SUB_AGENT_TURN.agentId)).toEqual([2]);
  });

  it("never belongs to a Turn of another Agent, even sending the same body", async () => {
    const [first] = everyMainTurn();
    await record([
      failedAttemptOf(first, { requestId: "req-sub-overloaded", secondsBefore: 2, agentId: SUB_AGENT_TURN.agentId }),
      first,
    ]);
    await refresh({ logsRoot: LOGS_ROOT, dbPath, recordingsRoot });

    expect(await failedAttemptCountsOf()).toEqual([0, 0]);
    expect(await failedAttemptCountsOf(SUB_AGENT_TURN.agentId)).toEqual([0]);
  });

  it("belongs, with the attempt before it, to the Turn that ends a chain of retries", async () => {
    const [first] = everyMainTurn();
    await record([
      failedAttemptOf(first, { requestId: "req-overloaded-1", secondsBefore: 9 }),
      { ...failedAttemptOf(first, { requestId: "req-reset", secondsBefore: 4 }), proxyError: "socket hang up" },
      first,
    ]);
    await refresh({ logsRoot: LOGS_ROOT, dbPath, recordingsRoot });

    expect(await failedAttemptCountsOf()).toEqual([2, 0]);
  });

  it("belongs to no Turn when no later API request with its body joined one", async () => {
    const [first, second] = everyMainTurn();
    await record([first, second, failedAttemptOf(first, { requestId: "req-overloaded", secondsBefore: 1 })]);
    await refresh({ logsRoot: LOGS_ROOT, dbPath, recordingsRoot });

    expect(await failedAttemptCountsOf()).toEqual([0, 0]);
  });

  it("leaves a Conversation's recorded state as its Turns' API requests make it", async () => {
    const [first, second, subAgentTurn] = everyMainTurn();
    const attemptOfSecond = failedAttemptOf(second, { requestId: "req-overloaded", secondsBefore: 3 });

    await record([first, attemptOfSecond, second]);
    expect((await refreshAndList()).get(MAIN_SESSION_ID)?.recordedState).toBe("partially-recorded");

    await record([subAgentTurn]);
    expect((await refreshAndList()).get(MAIN_SESSION_ID)?.recordedState).toBe("recorded");
    expect((await getConversation(MAIN_SESSION_ID, { dbPath }))?.recordedState).toBe("recorded");
  });
});

describe("Turn usage and Cost of a Recorded Conversation", () => {
  it("are identical with and without a failed attempt that reported no usage", async () => {
    const turns = everyMainTurn();
    await record(turns);
    await refresh({ logsRoot: LOGS_ROOT, dbPath, recordingsRoot });
    const withoutAttempt = await getConversation(MAIN_SESSION_ID, { dbPath });

    rmSync(tmpDir, { recursive: true, force: true });
    await record([failedAttemptOf(turns[1], { requestId: "req-overloaded", secondsBefore: 3 }), ...turns]);
    await refresh({ logsRoot: LOGS_ROOT, dbPath, recordingsRoot });
    const withAttempt = await getConversation(MAIN_SESSION_ID, { dbPath });

    expect(await failedAttemptCountsOf()).toEqual([0, 1]);
    expect(withAttempt?.costUsd).toBe(withoutAttempt?.costUsd);
    expect(withAttempt).toEqual(withoutAttempt);
  });

  it("are identical with and without its Recording", async () => {
    await refresh({ logsRoot: LOGS_ROOT, dbPath, recordingsRoot });
    const withoutRecording = await getConversation(MAIN_SESSION_ID, { dbPath });
    const listedWithoutRecording = await listConversations({ dbPath });

    rmSync(dbPath);
    await record(everyMainTurn());
    await refresh({ logsRoot: LOGS_ROOT, dbPath, recordingsRoot });
    const withRecording = await getConversation(MAIN_SESSION_ID, { dbPath });
    const listedWithRecording = await listConversations({ dbPath });

    expect(withRecording?.recordedState).toBe("recorded");
    expect({ ...withRecording, recordedState: null }).toEqual({ ...withoutRecording, recordedState: null });
    const withoutState = (summaries: ConversationSummary[]) =>
      summaries.map((summary) => ({ ...summary, recordedState: null }));
    expect(withoutState(listedWithRecording)).toEqual(withoutState(listedWithoutRecording));
  });
});

describe("an undecodable Recording", () => {
  it("leaves its Conversation unrecorded, is counted, and spares the others", async () => {
    await record([turnApiRequest({ sessionId: OTHER_SESSION_ID, requestId: "oreq-1", messageId: "omsg-1" })]);
    mkdirSync(recordingsRoot, { recursive: true });
    writeFileSync(path.join(recordingsRoot, `${MAIN_SESSION_ID}.jsonl.gz`), "not gzip at all");

    const summary = await refresh({ logsRoot: LOGS_ROOT, dbPath, recordingsRoot });
    const summaries = new Map((await listConversations({ dbPath })).map((s) => [s.id, s]));

    expect(summary.conversationsParsed).toBe(2);
    expect(summary.undecodableRecordingsSkipped).toBe(1);
    expect(summaries.get(MAIN_SESSION_ID)?.recordedState).toBe("unrecorded");
    expect(summaries.get(MAIN_SESSION_ID)?.tokens.total).toBeGreaterThan(0);
    expect(summaries.get(OTHER_SESSION_ID)?.recordedState).toBe("recorded");
  });
});

describe("a Recording change", () => {
  it("re-parses only its Conversation, once", async () => {
    await refresh({ logsRoot: LOGS_ROOT, dbPath, recordingsRoot });

    await record(MAIN_THREAD_TURNS.map((turn) => turnApiRequest({ sessionId: MAIN_SESSION_ID, ...turn })));
    const afterFirstRecording = await refresh({ logsRoot: LOGS_ROOT, dbPath, recordingsRoot });
    expect(afterFirstRecording).toMatchObject({ conversationsParsed: 1, conversationsSkipped: 1 });

    await record([turnApiRequest({ sessionId: MAIN_SESSION_ID, ...SUB_AGENT_TURN })]);
    const afterAppend = await refresh({ logsRoot: LOGS_ROOT, dbPath, recordingsRoot });
    expect(afterAppend).toMatchObject({ conversationsParsed: 1, conversationsSkipped: 1 });
    const summaries = new Map((await listConversations({ dbPath })).map((s) => [s.id, s]));
    expect(summaries.get(MAIN_SESSION_ID)?.recordedState).toBe("recorded");

    const unchanged = await refresh({ logsRoot: LOGS_ROOT, dbPath, recordingsRoot });
    expect(unchanged).toMatchObject({ conversationsParsed: 0, conversationsSkipped: 2 });
  });
});
