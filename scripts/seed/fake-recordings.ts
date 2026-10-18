// The fake Recordings behind `pnpm seed`: what a Recorder would have kept of
// the seeded Conversations, written with the real Recording writer so every
// Recorder feature can be shown without one. Each recorded Turn is derived from
// the in-memory Conversation its log was written from, so the join ingestion
// makes (`requestId`, then `message.id`) holds by construction. Nothing reads
// the clock or draws at random: the same Conversations write the same bytes.

import { openRecordingWriter, type RecordedApiRequest, type RecordedHeaders } from "@/core/recording";

import { CC_VERSION, type Conversation, RECORDED_SESSION_ID, type SeedToolName } from "./fake-logs";

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

/** The system prompt's opening block, the same for every Agent. */
const SYSTEM_IDENTITY = "You are Claude Code, Anthropic's official CLI for Claude.";

/** The main agent's instructions, then a sub-agent's. */
const MAIN_AGENT_INSTRUCTIONS =
  "You are an interactive agent that helps with software engineering tasks in the acme repositories. " +
  "Keep changes small, run the tests before you report, and never push without being asked.";
const SUB_AGENT_INSTRUCTIONS =
  "You are a sub-agent of Claude Code. Complete the task you are given, then report back in a few sentences.";

/** The placeholder credential and account ids the writer redacts. */
const PLACEHOLDER_AUTHORIZATION = "Bearer seed-placeholder-token";
const PLACEHOLDER_DEVICE_ID = "seed-device-0001";
const PLACEHOLDER_ACCOUNT_UUID = "seed-account-0001";

const SECOND = 1_000;
const HOUR = 3_600_000;

// ── API requests ────────────────────────────────────────────────────────────

/** A message of a Messages request, as Claude Code sends it. */
type ApiMessage = { role: "user" | "assistant"; content: unknown };

/** An assistant record of a seeded log, as far as an API request needs it. */
type AssistantRecord = {
  requestId: string;
  timestamp: string;
  message: { id: string; model: string; content: { type: string }[]; usage: unknown };
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

/** The system blocks an Agent sends, the last one marked for caching. */
function systemBlocks(agent: RecordedAgent): object[] {
  return [
    { type: "text", text: SYSTEM_IDENTITY },
    { type: "text", text: agent.agentId === null ? MAIN_AGENT_INSTRUCTIONS : SUB_AGENT_INSTRUCTIONS },
    {
      type: "text",
      text: `Working directory: ${agent.cwd}\nPlatform: linux\nClaude Code version: ${CC_VERSION}`,
      cache_control: { type: "ephemeral" },
    },
  ];
}

/** The tool definitions an Agent sends: every tool, but a sub-agent cannot spawn one. */
function toolDefinitions(agent: RecordedAgent): object[] {
  return (Object.keys(TOOL_DEFINITIONS) as SeedToolName[])
    .filter((name) => agent.agentId === null || name !== "Agent")
    .map((name) => ({
      name,
      description: TOOL_DEFINITIONS[name].description,
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
      system: systemBlocks(agent),
      tools: toolDefinitions(agent),
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
  const mainAgent: RecordedAgent = { sessionId: conversation.sessionId, agentId: null, cwd };
  return [
    ...turnsInLog(conversation.mainLines).map((turn) => turnApiRequest(mainAgent, turn)),
    ...conversation.subAgents.flatMap((sub) => {
      const subAgent: RecordedAgent = { sessionId: conversation.sessionId, agentId: sub.agentId, cwd };
      return turnsInLog(sub.lines).map((turn) => turnApiRequest(subAgent, turn));
    }),
  ];
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
  const apiRequests = conversationApiRequests(conversationOf(opts.conversations, RECORDED_SESSION_ID)).sort((a, b) =>
    a.timings.arrivedAt.localeCompare(b.timings.arrivedAt),
  );
  const writer = openRecordingWriter(opts.recordingsRoot);
  await Promise.all(apiRequests.map((apiRequest) => writer.append(apiRequest)));
}
