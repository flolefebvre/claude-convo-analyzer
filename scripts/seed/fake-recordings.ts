// The fake Recordings behind `pnpm seed`: what a Recorder would have kept of
// the seeded Conversations, written with the real Recording writer so every
// Recorder feature can be shown without one. Each recorded Turn is derived from
// the in-memory Conversation its log was written from, so the join ingestion
// makes (`requestId`, then `message.id`) holds by construction. Nothing reads
// the clock or draws at random: the same Conversations write the same bytes.
//
// What tells each API request apart, by its request alone (path, `max_tokens`,
// the system prompt's opening line, the model):
//
//   Turn             POST /v1/messages, `max_tokens: 32000`, three system
//                    blocks opening "You are Claude Code, Anthropic's official
//                    CLI for Claude.", the Agent's own model, the tool
//                    definitions, and the history as `messages`
//   session naming   POST /v1/messages, one system block opening "Name this
//                    coding session", a small model (Haiku), `max_tokens: 512`
//   quota probe      POST /v1/messages, `max_tokens: 1`, no system prompt, one
//                    tiny user message ("quota"), a small model
//   safety monitor   POST /v1/messages, one system block opening "Decide
//                    whether the shell command below is safe", a small model,
//                    `max_tokens: 256`
//   suggestion       POST /v1/messages, one system block opening "Suggest the
//                    prompt the user is most likely to send next", a small
//                    model, `max_tokens: 128`
//   token count      POST /v1/messages/count_tokens: no `max_tokens`, no
//                    response message, only `{ input_tokens }`
//
// Side requests carry no `x-claude-code-agent-id`, and a `request-id` and
// `message.id` no log record has. Streaming is NOT a distinguishing feature:
// the seed sends Turns streamed and Side requests not, as a simplification;
// real Side requests may stream.

import { openRecordingWriter, type RecordedApiRequest, type RecordedHeaders } from "@/core/recording";

import {
  CC_VERSION,
  type Conversation,
  PARTIALLY_RECORDED_SESSION_ID,
  RECORDED_SESSION_ID,
  RECORDED_TITLE,
  type SeedToolName,
} from "./fake-logs";

// ── Invented content (safe for a public README) ─────────────────────────────

/** Every tool definition a seeded API request sends, one per tool the fake logs call. */
const TOOL_DEFINITIONS: Record<SeedToolName, { description: string; properties: Record<string, object> }> = {
  Read: { description: "Read a file from the acme workspace.", properties: { file_path: { type: "string" } } },
  Bash: { description: "Run a shell command in the acme workspace.", properties: { command: { type: "string" } } },
  Edit: {
    description: "Replace a string in a file of the acme workspace.",
    properties: { file_path: { type: "string" }, old_string: { type: "string" }, new_string: { type: "string" } },
  },
  Grep: { description: "Search the acme workspace for a pattern.", properties: { pattern: { type: "string" } } },
  Skill: { description: "Run one of the acme team's skills by name.", properties: { skill: { type: "string" } } },
  Agent: {
    description: "Spawn a sub-agent to work on a task and report back.",
    properties: { subagent_type: { type: "string" }, description: { type: "string" }, prompt: { type: "string" } },
  },
  mcp__github__create_issue: {
    description: "Open an issue in an acme GitHub repository.",
    properties: { repository: { type: "string" }, title: { type: "string" } },
  },
  mcp__linear__search_issues: {
    description: "Search the acme Linear workspace for issues.",
    properties: { query: { type: "string" } },
  },
};

/** How the Linear MCP server describes its search tool once reconnected. */
const RECONNECTED_LINEAR_SEARCH_DESCRIPTION = "Search the acme Linear workspace for issues, by title, label or cycle.";

/** The system prompt's opening block, the same for every Agent. */
const SYSTEM_IDENTITY = "You are Claude Code, Anthropic's official CLI for Claude.";

/** The main agent's instructions, then a sub-agent's. */
const MAIN_AGENT_INSTRUCTIONS =
  "You are an interactive agent that helps with software engineering tasks in the acme repositories. " +
  "Keep changes small, run the tests before you report, and never push without being asked.";
const SUB_AGENT_INSTRUCTIONS =
  "You are a sub-agent of Claude Code. Complete the task you are given, then report back in a few sentences.";

/** The small model Side requests run on. */
const SIDE_REQUEST_MODEL = "claude-haiku-4-5-20251001";

/** Each Side request's one system block, its opening line telling the kind apart. */
const SESSION_NAMING_SYSTEM =
  "Name this coding session.\nReply with a JSON object holding a short, sentence-case title.";
const SAFETY_MONITOR_SYSTEM =
  "Decide whether the shell command below is safe to run without asking the user.\nReply with safe or unsafe.";
const SUGGESTION_SYSTEM =
  "Suggest the prompt the user is most likely to send next.\nReply with the prompt alone, in a few words.";

/** What the suggestion Side request answers. */
const SUGGESTED_PROMPT = "Open a pull request for the audit trail.";

/** What the unattributed API request asks, and what it is answered. */
const UNATTRIBUTED_PROMPT = "List the open pull requests on acme/acme-api.";
const UNATTRIBUTED_REPLY = "There are three open pull requests: two dependency bumps and the rate-limit change.";

/** The placeholder credential and account ids the writer redacts. */
const PLACEHOLDER_AUTHORIZATION = "Bearer seed-placeholder-token";
const PLACEHOLDER_DEVICE_ID = "seed-device-0001";
const PLACEHOLDER_ACCOUNT_UUID = "seed-account-0001";

/**
 * The first main-agent Turn (1-based) of the partially recorded Conversation
 * with an API request: the Recorder started just before it, and every Turn
 * from then on, sub-agents' included, is recorded.
 */
export const PARTIALLY_RECORDED_FROM_TURN = 4;

/** The `request-id` of each kind of Side request, all on the recorded Conversation's session. */
export const SIDE_REQUEST_IDS = {
  sessionNaming: "req-side-session-naming",
  quotaProbe: "req-side-quota-probe",
  safetyMonitor: "req-side-safety-monitor",
  suggestion: "req-side-suggestion",
  tokenCount: "req-side-token-count",
} as const;

/** The `request-id` of the overloaded (529) attempt Claude Code retried before one of the recorded Conversation's Turns. */
export const FAILED_ATTEMPT_REQUEST_ID = "req-attempt-overloaded";

/** The `request-id` of the one API request no session could be found for, so filed as unattributed. */
export const UNATTRIBUTED_REQUEST_ID = "req-unattributed";

/** The recorded Conversation's main-agent Turn (1-based) that {@link FAILED_ATTEMPT_REQUEST_ID} precedes. */
const RETRIED_TURN = 3;

/** The main-agent Turn (1-based) from which one system block reads differently. */
export const SYSTEM_PROMPT_CHANGE_TURN = 5;

/** The main-agent Turn (1-based) from which one tool definition reads differently. */
export const TOOL_DEFINITION_CHANGE_TURN = 4;

const SECOND = 1_000;
const HOUR = 3_600_000;

// ── API requests ────────────────────────────────────────────────────────────

/** A message of a Messages request, as Claude Code sends it. */
type ApiMessage = { role: "user" | "assistant"; content: unknown };

/** A content block of an assistant message; `name` and `input` are a `tool_use` block's. */
type ContentBlock = { type: string; name?: string; input?: Record<string, unknown> };

/** An assistant record of a seeded log, as far as an API request needs it. */
type AssistantRecord = {
  requestId: string;
  timestamp: string;
  message: { id: string; model: string; content: ContentBlock[]; usage: unknown };
};

/** A Turn of one Agent: its record, its 1-based position, and the messages sent before it. */
type AgentTurn = { record: AssistantRecord; ordinal: number; history: ApiMessage[] };

/** The Agent an API request is sent for. */
type RecordedAgent = { sessionId: string; agentId: string | null; cwd: string };

/** Every Turn in an Agent's log `lines`, each with the messages before it. */
function turnsInLog(lines: readonly string[]): AgentTurn[] {
  const history: ApiMessage[] = [];
  const turns: AgentTurn[] = [];
  for (const line of lines) {
    const record = JSON.parse(line) as { type?: string; message?: { content: unknown } };
    if (record.type === "user" && record.message) history.push({ role: "user", content: record.message.content });
    if (record.type === "assistant") {
      const assistantRecord = record as AssistantRecord;
      turns.push({ record: assistantRecord, ordinal: turns.length + 1, history: [...history] });
      history.push({ role: "assistant", content: assistantRecord.message.content });
    }
  }
  return turns;
}

/** True when `turn` is a main-agent Turn at or after the main agent's Turn `ordinal`. */
function isMainTurnFrom(agent: RecordedAgent, turn: AgentTurn, ordinal: number): boolean {
  return agent.agentId === null && turn.ordinal >= ordinal;
}

/**
 * The system blocks an Agent sends for `turn`, the last one marked for
 * caching. From the main agent's Turn {@link SYSTEM_PROMPT_CHANGE_TURN} on,
 * the environment block reports the files its `Bash` call changed.
 */
function systemBlocks(agent: RecordedAgent, turn: AgentTurn): object[] {
  const gitStatus = isMainTurnFrom(agent, turn, SYSTEM_PROMPT_CHANGE_TURN) ? "2 files modified" : "clean";
  return [
    { type: "text", text: SYSTEM_IDENTITY },
    { type: "text", text: agent.agentId === null ? MAIN_AGENT_INSTRUCTIONS : SUB_AGENT_INSTRUCTIONS },
    {
      type: "text",
      text: `Working directory: ${agent.cwd}\nPlatform: linux\nClaude Code version: ${CC_VERSION}\nGit status: ${gitStatus}`,
      cache_control: { type: "ephemeral" },
    },
  ];
}

/**
 * The tool definitions an Agent sends for `turn`: every tool, but a sub-agent
 * cannot spawn one. From the main agent's Turn
 * {@link TOOL_DEFINITION_CHANGE_TURN} on, the Linear MCP server, reconnected,
 * describes its search tool anew.
 */
function toolDefinitions(agent: RecordedAgent, turn: AgentTurn): object[] {
  const isLinearReconnected = isMainTurnFrom(agent, turn, TOOL_DEFINITION_CHANGE_TURN);
  return (Object.keys(TOOL_DEFINITIONS) as SeedToolName[])
    .filter((name) => agent.agentId === null || name !== "Agent")
    .map((name) => ({
      name,
      description:
        name === "mcp__linear__search_issues" && isLinearReconnected
          ? RECONNECTED_LINEAR_SEARCH_DESCRIPTION
          : TOOL_DEFINITIONS[name].description,
      input_schema: {
        type: "object",
        properties: TOOL_DEFINITIONS[name].properties,
        required: Object.keys(TOOL_DEFINITIONS[name].properties),
      },
    }));
}

/** The request headers Claude Code sends for `agent`. */
function requestHeaders(agent: RecordedAgent): RecordedHeaders {
  return {
    "anthropic-version": "2023-06-01",
    authorization: PLACEHOLDER_AUTHORIZATION,
    "content-type": "application/json",
    "user-agent": `claude-cli/${CC_VERSION} (external, cli)`,
    "x-app": "cli",
    "x-claude-code-session-id": agent.sessionId,
    ...(agent.agentId === null ? {} : { "x-claude-code-agent-id": agent.agentId }),
  };
}

/** `metadata.user_id` in its JSON shape: placeholder device and account, the real session id. */
function metadataOf(agent: RecordedAgent): object {
  return {
    user_id: JSON.stringify({
      device_id: PLACEHOLDER_DEVICE_ID,
      account_uuid: PLACEHOLDER_ACCOUNT_UUID,
      session_id: agent.sessionId,
    }),
  };
}

/**
 * The quota headers of a response arriving at `arrivedMs`. The names and the
 * values are plausible, not verified against the real API: confirm them on a
 * real Recording before relying on them. Utilization grows through each 5-hour
 * and 7-day window, so it depends on the time alone.
 */
function rateLimitHeaders(arrivedMs: number): RecordedHeaders {
  const fiveHours = 5 * HOUR;
  const sevenDays = 7 * 24 * HOUR;
  return {
    "anthropic-ratelimit-unified-status": "allowed",
    "anthropic-ratelimit-unified-5h-utilization": (((arrivedMs % fiveHours) / fiveHours) * 0.8).toFixed(2),
    "anthropic-ratelimit-unified-7d-utilization": (((arrivedMs % sevenDays) / sevenDays) * 0.6).toFixed(2),
    "anthropic-ratelimit-unified-reset": String(Math.ceil(arrivedMs / fiveHours) * (fiveHours / SECOND)),
  };
}

/** When an API request whose response ended at `endedMs` arrived, got its first byte, and ended. */
function timingsEndingAt(endedMs: number): RecordedApiRequest["timings"] {
  return {
    arrivedAt: new Date(endedMs - 4.4 * SECOND).toISOString(),
    firstByteAt: new Date(endedMs - 3.4 * SECOND).toISOString(),
    endedAt: new Date(endedMs).toISOString(),
  };
}

/** The streamed API request of one Turn: its log record's ids, model, content and usage, unchanged. */
function turnApiRequest(agent: RecordedAgent, turn: AgentTurn): RecordedApiRequest {
  const { record } = turn;
  const endedMs = Date.parse(record.timestamp) + 0.4 * SECOND;
  const timings = timingsEndingAt(endedMs);
  return {
    sessionId: agent.sessionId,
    agentId: agent.agentId,
    method: "POST",
    path: "/v1/messages",
    query: "beta=true",
    headers: requestHeaders(agent),
    body: {
      model: record.message.model,
      max_tokens: 32_000,
      stream: true,
      metadata: metadataOf(agent),
      system: systemBlocks(agent, turn),
      tools: toolDefinitions(agent, turn),
      messages: turn.history,
    },
    response: {
      status: 200,
      requestId: record.requestId,
      headers: {
        "content-type": "text/event-stream",
        "request-id": record.requestId,
        ...rateLimitHeaders(Date.parse(timings.arrivedAt)),
      },
      body: {
        id: record.message.id,
        type: "message",
        role: "assistant",
        model: record.message.model,
        content: record.message.content,
        stop_reason: record.message.content.some((block) => block.type === "tool_use") ? "tool_use" : "end_turn",
        stop_sequence: null,
        usage: record.message.usage,
      },
      isStreamed: true,
    },
    timings,
  };
}

/** The API request of every Turn of `conversation`, main agent and sub-agents alike. */
function conversationApiRequests(conversation: Conversation): RecordedApiRequest[] {
  const cwd = conversation.projectPath;
  const mainAgent = mainAgentOf(conversation);
  return [
    ...turnsInLog(conversation.mainLines).map((turn) => turnApiRequest(mainAgent, turn)),
    ...conversation.subAgents.flatMap((sub) => {
      const subAgent: RecordedAgent = { sessionId: conversation.sessionId, agentId: sub.agentId, cwd };
      return turnsInLog(sub.lines).map((turn) => turnApiRequest(subAgent, turn));
    }),
  ];
}

/** A Side request of the main agent, answered with plain JSON, its response ending at `endedMs`. */
function sideApiRequest(
  agent: RecordedAgent,
  opts: { path: string; body: object; requestId: string; responseBody: object; endedMs: number },
): RecordedApiRequest {
  const timings = timingsEndingAt(opts.endedMs);
  return {
    sessionId: agent.sessionId,
    agentId: null,
    method: "POST",
    path: opts.path,
    query: "beta=true",
    headers: requestHeaders(agent),
    body: opts.body,
    response: {
      status: 200,
      requestId: opts.requestId,
      headers: {
        "content-type": "application/json",
        "request-id": opts.requestId,
        ...rateLimitHeaders(Date.parse(timings.arrivedAt)),
      },
      body: opts.responseBody,
      isStreamed: false,
    },
    timings,
  };
}

/** The message a Side request is answered with: `text`, from the small model. */
function sideRequestMessage(
  requestId: string,
  text: string,
  usage: { input_tokens: number; output_tokens: number },
): object {
  return {
    id: requestId.replace(/^req-/, "msg-"),
    type: "message",
    role: "assistant",
    model: SIDE_REQUEST_MODEL,
    content: [{ type: "text", text }],
    stop_reason: usage.output_tokens === 1 ? "max_tokens" : "end_turn",
    stop_sequence: null,
    usage: { ...usage, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
  };
}

function quotaProbeApiRequest(agent: RecordedAgent, endedMs: number): RecordedApiRequest {
  const requestId = SIDE_REQUEST_IDS.quotaProbe;
  return sideApiRequest(agent, {
    path: "/v1/messages",
    body: {
      model: SIDE_REQUEST_MODEL,
      max_tokens: 1,
      metadata: metadataOf(agent),
      messages: [{ role: "user", content: "quota" }],
    },
    requestId,
    responseBody: sideRequestMessage(requestId, "#", { input_tokens: 8, output_tokens: 1 }),
    endedMs,
  });
}

function sessionNamingApiRequest(agent: RecordedAgent, firstPrompt: string, endedMs: number): RecordedApiRequest {
  const requestId = SIDE_REQUEST_IDS.sessionNaming;
  return sideApiRequest(agent, {
    path: "/v1/messages",
    body: {
      model: SIDE_REQUEST_MODEL,
      max_tokens: 512,
      metadata: metadataOf(agent),
      system: [{ type: "text", text: SESSION_NAMING_SYSTEM }],
      messages: [{ role: "user", content: firstPrompt }],
    },
    requestId,
    responseBody: sideRequestMessage(requestId, JSON.stringify({ title: RECORDED_TITLE }), {
      input_tokens: 164,
      output_tokens: 18,
    }),
    endedMs,
  });
}

function safetyMonitorApiRequest(agent: RecordedAgent, command: string, endedMs: number): RecordedApiRequest {
  const requestId = SIDE_REQUEST_IDS.safetyMonitor;
  return sideApiRequest(agent, {
    path: "/v1/messages",
    body: {
      model: SIDE_REQUEST_MODEL,
      max_tokens: 256,
      metadata: metadataOf(agent),
      system: [{ type: "text", text: SAFETY_MONITOR_SYSTEM }],
      messages: [{ role: "user", content: command }],
    },
    requestId,
    responseBody: sideRequestMessage(requestId, "safe", { input_tokens: 92, output_tokens: 2 }),
    endedMs,
  });
}

function suggestionApiRequest(agent: RecordedAgent, lastReply: unknown, endedMs: number): RecordedApiRequest {
  const requestId = SIDE_REQUEST_IDS.suggestion;
  return sideApiRequest(agent, {
    path: "/v1/messages",
    body: {
      model: SIDE_REQUEST_MODEL,
      max_tokens: 128,
      metadata: metadataOf(agent),
      system: [{ type: "text", text: SUGGESTION_SYSTEM }],
      messages: [{ role: "user", content: lastReply }],
    },
    requestId,
    responseBody: sideRequestMessage(requestId, SUGGESTED_PROMPT, { input_tokens: 311, output_tokens: 9 }),
    endedMs,
  });
}

/** Counting the tokens of what `turn` sends: the same system, tools and messages. */
function tokenCountApiRequest(agent: RecordedAgent, turn: AgentTurn, endedMs: number): RecordedApiRequest {
  return sideApiRequest(agent, {
    path: "/v1/messages/count_tokens",
    body: {
      model: turn.record.message.model,
      system: systemBlocks(agent, turn),
      tools: toolDefinitions(agent, turn),
      messages: turn.history,
    },
    requestId: SIDE_REQUEST_IDS.tokenCount,
    responseBody: { input_tokens: 21_384 },
    endedMs,
  });
}

/**
 * One Side request of each kind, on `conversation`'s session: the quota probe
 * and the session naming right after its first prompt, a token count after
 * its third Turn, the safety monitor before its `Bash` call runs, and a
 * suggestion after its last Turn.
 */
function sideApiRequests(conversation: Conversation): RecordedApiRequest[] {
  const agent = mainAgentOf(conversation);
  const turns = turnsInLog(conversation.mainLines);
  const firstPrompt = conversation.mainLines
    .map((line) => JSON.parse(line) as { type?: string; timestamp: string; message: { content: string } })
    .find((record) => record.type === "user")!;
  const firstPromptMs = Date.parse(firstPrompt.timestamp);
  const bashCall = turns
    .flatMap((turn) => turn.record.message.content.map((block) => ({ turn, block })))
    .find(({ block }) => block.type === "tool_use" && block.name === "Bash")!;
  const lastTurn = turns.at(-1)!;
  return [
    quotaProbeApiRequest(agent, firstPromptMs + 1 * SECOND),
    sessionNamingApiRequest(agent, firstPrompt.message.content, firstPromptMs + 2.5 * SECOND),
    tokenCountApiRequest(agent, turns[2], timestampMs(turns[2]) + 2 * SECOND),
    safetyMonitorApiRequest(agent, String(bashCall.block.input?.command), timestampMs(bashCall.turn) + 1.5 * SECOND),
    suggestionApiRequest(agent, lastTurn.record.message.content, timestampMs(lastTurn) + 2 * SECOND),
  ];
}

/** When a Turn's log record was written, in epoch ms. */
function timestampMs(turn: AgentTurn): number {
  return Date.parse(turn.record.timestamp);
}

/** The main agent of `conversation`. */
function mainAgentOf(conversation: Conversation): RecordedAgent {
  return { sessionId: conversation.sessionId, agentId: null, cwd: conversation.projectPath };
}

/**
 * The API requests of a Conversation the Recorder started on mid-way, just
 * before its main agent's Turn {@link PARTIALLY_RECORDED_FROM_TURN}: each
 * still sends the whole history before it.
 */
function partiallyRecordedApiRequests(conversation: Conversation): RecordedApiRequest[] {
  const apiRequests = conversationApiRequests(conversation);
  const mainAgentApiRequests = apiRequests.filter((r) => r.agentId === null);
  const recorderStartedAt = mainAgentApiRequests[PARTIALLY_RECORDED_FROM_TURN - 1].timings.arrivedAt;
  return apiRequests.filter((r) => r.timings.arrivedAt >= recorderStartedAt);
}

/**
 * The attempt the API turned away as overloaded, just before `retry`: the
 * same request, answered `529` with an error body. Claude Code retries it
 * without logging anything, so its `request-id` is in no log.
 */
function failedAttemptBefore(retry: RecordedApiRequest): RecordedApiRequest {
  const retryArrivedMs = Date.parse(retry.timings.arrivedAt);
  const endedAt = new Date(retryArrivedMs - 2.6 * SECOND).toISOString();
  return {
    ...retry,
    response: {
      status: 529,
      requestId: FAILED_ATTEMPT_REQUEST_ID,
      headers: {
        "content-type": "application/json",
        "request-id": FAILED_ATTEMPT_REQUEST_ID,
        "x-should-retry": "true",
      },
      body: { type: "error", error: { type: "overloaded_error", message: "Overloaded" } },
      isStreamed: false,
    },
    timings: { arrivedAt: new Date(retryArrivedMs - 3 * SECOND).toISOString(), firstByteAt: endedAt, endedAt },
  };
}

/**
 * An API request no session can be found for: no session header, no
 * `metadata.user_id`, and no other session active, so the Recorder files it
 * as unattributed. It matches no seeded Conversation.
 */
function unattributedApiRequest(endedMs: number): RecordedApiRequest {
  const timings = timingsEndingAt(endedMs);
  return {
    sessionId: null,
    agentId: null,
    method: "POST",
    path: "/v1/messages",
    query: "beta=true",
    headers: {
      "anthropic-version": "2023-06-01",
      authorization: PLACEHOLDER_AUTHORIZATION,
      "content-type": "application/json",
      "user-agent": `claude-cli/${CC_VERSION} (external, cli)`,
      "x-app": "cli",
    },
    body: {
      model: SIDE_REQUEST_MODEL,
      max_tokens: 1_024,
      stream: true,
      messages: [{ role: "user", content: UNATTRIBUTED_PROMPT }],
    },
    response: {
      status: 200,
      requestId: UNATTRIBUTED_REQUEST_ID,
      headers: {
        "content-type": "text/event-stream",
        "request-id": UNATTRIBUTED_REQUEST_ID,
        ...rateLimitHeaders(Date.parse(timings.arrivedAt)),
      },
      body: {
        id: "msg-unattributed",
        type: "message",
        role: "assistant",
        model: SIDE_REQUEST_MODEL,
        content: [{ type: "text", text: UNATTRIBUTED_REPLY }],
        stop_reason: "end_turn",
        stop_sequence: null,
        usage: { input_tokens: 24, output_tokens: 31, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
      },
      isStreamed: true,
    },
    timings,
  };
}

/** The seeded Conversation of `sessionId`. */
function conversationOf(conversations: readonly Conversation[], sessionId: string): Conversation {
  const conversation = conversations.find((c) => c.sessionId === sessionId);
  if (!conversation) throw new Error(`no seeded Conversation has session ${sessionId}`);
  return conversation;
}

/**
 * Write the Recordings of the seeded `conversations` under `recordingsRoot`,
 * through the real Recording writer, each file in the order its API requests
 * arrived.
 *
 * @example
 * const { conversations } = generateFakeLogs({ logsRoot, now });
 * await writeFakeRecordings({ recordingsRoot: "data/seed/recordings", conversations });
 */
export async function writeFakeRecordings(opts: {
  recordingsRoot: string;
  conversations: readonly Conversation[];
}): Promise<void> {
  const recorded = conversationOf(opts.conversations, RECORDED_SESSION_ID);
  const recordedTurns = conversationApiRequests(recorded);
  const apiRequests = [
    ...recordedTurns,
    failedAttemptBefore(recordedTurns.filter((r) => r.agentId === null)[RETRIED_TURN - 1]),
    ...sideApiRequests(recorded),
    unattributedApiRequest(Date.parse(turnsInLog(recorded.mainLines)[0].record.timestamp) - HOUR),
    ...partiallyRecordedApiRequests(conversationOf(opts.conversations, PARTIALLY_RECORDED_SESSION_ID)),
  ].sort((a, b) => a.timings.arrivedAt.localeCompare(b.timings.arrivedAt));
  const writer = openRecordingWriter(opts.recordingsRoot);
  await Promise.all(apiRequests.map((apiRequest) => writer.append(apiRequest)));
}
