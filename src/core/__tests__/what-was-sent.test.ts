// What was sent (GLOSSARY.md): for a recorded Turn, what its API request sent
// the model — the messages new since the previous API request of the same
// Agent, the request parameters and timings, and the whole system prompt and
// tool definitions — located through the database, read from the Recording.

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { getTranscript, type TranscriptMessage } from "@/core/read";
import { openRecordingWriter, type RecordedApiRequest } from "@/core/recording";
import { refresh } from "@/core/refresh";
import { getWhatWasSent, type SentMessage } from "@/core/what-was-sent";

const LOGS_ROOT = path.join(import.meta.dirname, "fixtures", "what-was-sent-logs");
const SESSION_ID = "sess-sent";
const SUB_AGENT_ID = "ssub1";

/** A message of a Messages request. */
type ApiMessage = { role: "user" | "assistant"; content: unknown };

const SYSTEM = [
  { type: "text", text: "You are Claude Code, Anthropic's official CLI for Claude." },
  {
    type: "text",
    text: "Working directory: /Users/me/dev/sent\nGit status: clean",
    cache_control: { type: "ephemeral" },
  },
];
const TOOLS = [
  {
    name: "Bash",
    description: "Run a shell command.",
    input_schema: { type: "object", properties: { command: { type: "string" } } },
  },
];

/** What the Main thread sends before each of its three Turns. */
const PROMPT_1: ApiMessage = { role: "user", content: "audit the exports" };
const AGENT_TOOL_USE = {
  type: "tool_use",
  id: "stu-1",
  name: "Agent",
  input: { subagent_type: "Explore", description: "find the exports", prompt: "Find the export code." },
};
const REPLY_1: ApiMessage = { role: "assistant", content: [AGENT_TOOL_USE] };
const AGENT_TOOL_RESULT = {
  type: "tool_result",
  tool_use_id: "stu-1",
  content: "The exports live in billing/export.ts.",
};
const SYSTEM_REMINDER = "<system-reminder>The user opened billing/export.ts.</system-reminder>";
const RESULT_1: ApiMessage = {
  role: "user",
  content: [AGENT_TOOL_RESULT, { type: "text", text: SYSTEM_REMINDER }],
};
const REPLY_2: ApiMessage = {
  role: "assistant",
  content: [{ type: "text", text: "The exports live in billing/export.ts." }],
};
const PROMPT_3: ApiMessage = { role: "user", content: "now add a test" };

/** The running test's scratch directory, holding its Recordings and its database. */
let scratchDir = "";
let recordingsRoot = "";
let dbPath = "";

beforeEach(() => {
  scratchDir = mkdtempSync(path.join(tmpdir(), "cca-what-was-sent-"));
  [recordingsRoot, dbPath] = [path.join(scratchDir, "recordings"), path.join(scratchDir, "analyzer.db")];
});

afterEach(() => rmSync(scratchDir, { recursive: true, force: true }));

/** The API request of one Turn (or a Side request), arriving at `arrivedAt`. */
function apiRequest(opts: {
  requestId: string | null;
  messageId: string | null;
  arrivedAt: string;
  messages: ApiMessage[];
  agentId?: string | null;
  status?: number;
  system?: unknown;
  tools?: unknown[];
  parameters?: Record<string, unknown>;
  headers?: Record<string, string>;
}): RecordedApiRequest {
  const arrivedMs = Date.parse(opts.arrivedAt);
  return {
    sessionId: SESSION_ID,
    agentId: opts.agentId ?? null,
    method: "POST",
    path: "/v1/messages",
    query: "beta=true",
    headers: { "anthropic-version": "2023-06-01", ...opts.headers },
    body: {
      model: "claude-opus-4-8",
      max_tokens: 32000,
      ...opts.parameters,
      system: opts.system ?? SYSTEM,
      tools: opts.tools ?? TOOLS,
      messages: opts.messages,
    },
    response: {
      status: opts.status ?? 200,
      requestId: opts.requestId,
      headers: {},
      body: opts.messageId === null ? null : { id: opts.messageId, type: "message", content: [] },
      isStreamed: true,
    },
    timings: {
      arrivedAt: opts.arrivedAt,
      firstByteAt: new Date(arrivedMs + 800).toISOString(),
      endedAt: new Date(arrivedMs + 3000).toISOString(),
    },
  };
}

/** The three Main-thread Turns, each sending the history before it. */
function mainTurns(): RecordedApiRequest[] {
  return [
    apiRequest({
      requestId: "sreq-1",
      messageId: "smsg-1",
      arrivedAt: "2026-10-18T10:00:01.000Z",
      messages: [PROMPT_1],
    }),
    apiRequest({
      requestId: "sreq-2",
      messageId: "smsg-2",
      arrivedAt: "2026-10-18T10:01:05.000Z",
      messages: [PROMPT_1, REPLY_1, RESULT_1],
    }),
    apiRequest({
      requestId: "sreq-3",
      messageId: "smsg-3",
      arrivedAt: "2026-10-18T10:02:05.000Z",
      messages: [PROMPT_1, REPLY_1, RESULT_1, REPLY_2, PROMPT_3],
    }),
  ];
}

/** The sub-agent's one Turn. */
function subAgentTurn(): RecordedApiRequest {
  return apiRequest({
    requestId: "sreq-sub-1",
    messageId: "smsg-sub-1",
    agentId: SUB_AGENT_ID,
    arrivedAt: "2026-10-18T10:00:15.000Z",
    parameters: { model: "claude-haiku-4-5-20251001" },
    messages: [{ role: "user", content: "Find the export code." }],
  });
}

/** Record `apiRequests`, then Refresh the fixture logs with them. */
async function recordAndRefresh(apiRequests: RecordedApiRequest[]): Promise<void> {
  const writer = openRecordingWriter(recordingsRoot);
  for (const request of apiRequests) await writer.append(request);
  await refresh({ logsRoot: LOGS_ROOT, dbPath, recordingsRoot });
}

/** The assistant Turns of one Agent's transcript (`agentId` undefined: the Main thread). */
async function turnsOf(agentId?: string): Promise<TranscriptMessage[]> {
  const view = await getTranscript(SESSION_ID, { dbPath, agentId });
  return (view?.messages ?? []).filter((message) => message.role === "assistant");
}

/** What was sent for the `ordinal`-th (1-based) assistant Turn of an Agent. */
async function whatWasSentForTurn(ordinal: number, agentId?: string) {
  const turn = (await turnsOf(agentId))[ordinal - 1];
  expect(turn?.apiRequestId).toEqual(expect.any(Number));
  return getWhatWasSent(turn!.apiRequestId!, { dbPath, recordingsRoot });
}

/** Messages as their role and the text (or JSON) of each block. */
function summarized(messages: SentMessage[] | undefined): string[][] {
  return (messages ?? []).map((message) => [
    message.role,
    ...message.blocks.map((block) => (block.kind === "text" ? block.text : block.json)),
  ]);
}

describe("a Turn's API request", () => {
  it("is on every recorded Turn of the transcript, and on no unrecorded one", async () => {
    await recordAndRefresh(mainTurns().slice(1));

    const turns = await turnsOf();

    expect(turns.map((turn) => turn.apiRequestId === null)).toEqual([true, false, false]);
    const view = await getTranscript(SESSION_ID, { dbPath });
    expect(view?.messages.filter((m) => m.role === "user").every((m) => m.apiRequestId === null)).toBe(true);
  });

  it("is the 2xx one when a failed attempt matched the same Turn", async () => {
    const [first] = mainTurns();
    const failedAttempt = { ...first, response: { ...first.response, status: 529 } };
    await recordAndRefresh([
      first,
      { ...failedAttempt, timings: { ...first.timings, arrivedAt: "2026-10-18T10:00:02.000Z" } },
    ]);

    const sent = await whatWasSentForTurn(1);

    expect(sent?.timings.timeToFirstByteMs).toBe(800);
  });
});

describe("what was sent for a Turn", () => {
  it("is every message of the Main thread's first Turn, with no previous API request", async () => {
    await recordAndRefresh(mainTurns());

    const sent = await whatWasSentForTurn(1);

    expect(sent?.previousApiRequestId).toBeNull();
    expect(summarized(sent?.newMessages)).toEqual([["user", "audit the exports"]]);
  });

  it("is the whole opening of a sub-agent's first Turn", async () => {
    await recordAndRefresh([...mainTurns(), subAgentTurn()]);

    const sent = await whatWasSentForTurn(1, SUB_AGENT_ID);

    expect(sent?.previousApiRequestId).toBeNull();
    expect(summarized(sent?.newMessages)).toEqual([["user", "Find the export code."]]);
  });

  it("is only the messages the previous API request of the same Agent did not send, system-reminders included", async () => {
    await recordAndRefresh([...mainTurns(), subAgentTurn()]);

    const sent = await whatWasSentForTurn(2);

    expect(summarized(sent?.newMessages)).toEqual([
      ["assistant", JSON.stringify(AGENT_TOOL_USE, null, 2)],
      ["user", JSON.stringify(AGENT_TOOL_RESULT, null, 2), SYSTEM_REMINDER],
    ]);
  });

  it("does not count a message as new because its cache breakpoint moved", async () => {
    const turns = mainTurns();
    const withBreakpoint: ApiMessage = {
      role: "user",
      content: [{ type: "text", text: "audit the exports", cache_control: { type: "ephemeral" } }],
    };
    const withoutBreakpoint: ApiMessage = { role: "user", content: [{ type: "text", text: "audit the exports" }] };
    turns[0] = apiRequest({ ...requestFields(turns[0]), messages: [withBreakpoint] });
    turns[1] = apiRequest({ ...requestFields(turns[1]), messages: [withoutBreakpoint, REPLY_1, RESULT_1] });
    await recordAndRefresh(turns);

    const sent = await whatWasSentForTurn(2);

    expect(sent?.newMessages.map((message) => message.role)).toEqual(["assistant", "user"]);
  });

  it("skips a Side request and a failed attempt between the two Turns", async () => {
    const turns = mainTurns();
    const sideRequest = apiRequest({
      requestId: "sreq-side",
      messageId: "smsg-side",
      arrivedAt: "2026-10-18T10:01:20.000Z",
      messages: [{ role: "user", content: "Name this coding session" }],
    });
    const failedAttempt = apiRequest({
      requestId: "sreq-overloaded",
      messageId: null,
      status: 529,
      arrivedAt: "2026-10-18T10:02:01.000Z",
      messages: [PROMPT_1, REPLY_1, RESULT_1, REPLY_2, PROMPT_3],
    });
    await recordAndRefresh([...turns, sideRequest, failedAttempt]);

    const sent = await whatWasSentForTurn(3);
    const second = (await turnsOf())[1];

    expect(sent?.previousApiRequestId).toBe(second?.apiRequestId);
    expect(summarized(sent?.newMessages)).toEqual([
      ["assistant", "The exports live in billing/export.ts."],
      ["user", "now add a test"],
    ]);
  });

  it("carries the request parameters and the timings", async () => {
    const [first] = mainTurns();
    await recordAndRefresh([
      apiRequest({
        ...requestFields(first),
        parameters: { thinking: { type: "enabled", budget_tokens: 31999 }, output_config: { effort: "high" } },
        headers: { "anthropic-beta": "claude-code-20250219, interleaved-thinking-2025-05-14" },
      }),
    ]);

    const sent = await whatWasSentForTurn(1);

    expect(sent?.parameters).toEqual({
      model: "claude-opus-4-8",
      maxTokens: 32000,
      thinking: "enabled · budget_tokens 31999",
      effort: "high",
      betas: ["claude-code-20250219", "interleaved-thinking-2025-05-14"],
    });
    expect(sent?.timings).toEqual({ timeToFirstByteMs: 800, durationMs: 3000 });
  });

  it("shows a thinking parameter of any shape", async () => {
    const [first] = mainTurns();
    await recordAndRefresh([apiRequest({ ...requestFields(first), parameters: { thinking: "adaptive-ish" } })]);

    expect((await whatWasSentForTurn(1))?.parameters.thinking).toBe('"adaptive-ish"');
  });

  it("holds the whole system prompt with its cache breakpoints, and every tool definition", async () => {
    await recordAndRefresh(mainTurns());

    const sent = await whatWasSentForTurn(2);

    expect(sent?.fullRequest.systemBlocks).toEqual([
      { kind: "text", text: SYSTEM[0].text, cacheControl: null },
      { kind: "text", text: SYSTEM[1].text, cacheControl: "ephemeral" },
    ]);
    expect(sent?.fullRequest.tools).toEqual([{ name: "Bash", definitionJson: JSON.stringify(TOOLS[0], null, 2) }]);
  });

  it("is null when the Recording no longer holds the API request", async () => {
    await recordAndRefresh(mainTurns());
    const [turn] = await turnsOf();
    rmSync(recordingsRoot, { recursive: true, force: true });
    const writer = openRecordingWriter(recordingsRoot);
    await writer.append(mainTurns()[1]);

    expect(await getWhatWasSent(turn!.apiRequestId!, { dbPath, recordingsRoot })).toBeNull();
  });

  it("is null for an unknown API request", async () => {
    await recordAndRefresh(mainTurns());

    expect(await getWhatWasSent(999_999, { dbPath, recordingsRoot })).toBeNull();
  });
});

/** The fields `apiRequest` builds `request` from, to rebuild it with a change. */
function requestFields(request: RecordedApiRequest): Parameters<typeof apiRequest>[0] {
  const body = request.body as { messages: ApiMessage[] };
  return {
    requestId: request.response.requestId,
    messageId: (request.response.body as { id: string } | null)?.id ?? null,
    arrivedAt: request.timings.arrivedAt,
    messages: body.messages,
  };
}
