// Recorded Conversations (GLOSSARY.md, Recorded): a Refresh joins each API
// request of a Recording to its Conversation and, when it is one, to its Turn
// — by `requestId`, else by `message.id`, in the Main thread or a sub-agent —
// and the list says whether every Turn, some, or none have an API request. The
// Recording only ever adds: Turn usage and Cost stay the transcript's.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { type ConversationSummary, getConversation, listConversations } from "@/core/read";
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
    body: { model: "claude-opus-4-8", max_tokens: 32000, messages: [{ role: "user", content: "audit the exports" }] },
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

describe("Turn usage and Cost of a Recorded Conversation", () => {
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
