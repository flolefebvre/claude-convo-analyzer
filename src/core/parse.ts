// JSONL session parser (findings #2,#3,#4,#7,#8,#10). Reads one session file's
// lines into a typed, deduplicated `ParsedSession` ready for DB write.
//
// SLICE SCOPE: handles `assistant`, `user` (incl. tool_result), `ai-title`,
// `custom-title`, `pr-link`, `system`/`turn_duration`, `queued_command`
// attachments (mid-turn user Messages), and the `api-request` and
// `api-request-shape` request records (log-format §9); tool_use blocks and
// `Agent` spawn ledgers are lifted too. Other record types are skipped gracefully
// (log-format §6). A line that fails JSON.parse is skipped and counted (never fatal).
//
// EXTENSION POINTS:
//   - `parseSessionLines` is the single dispatch site over record `type`; add new
//     branches there. The same routine parses a sub-agent transcript (it is the
//     same per-turn shape — GLOSSARY.md), so refresh reuses it directly for subs.
//   - `extractText` / `extractToolUseBlocks` decode the `content` union once.
//   - `ParsedMessage` already carries `uuid`/`parentUuid` so Slice 4 can build the
//     message-uuid index for continued-from resolution.

import { createHash } from "node:crypto";
import { z } from "zod";

import { canonicalJson } from "@/core/canonical-json";

/** A `tool_use` block lifted out of an assistant message (one `tool_call` row). */
export type ParsedToolUse = {
  /** `tool_use` block id; matches a later tool_result's `tool_use_id`. */
  toolUseId: string | null;
  /** Tool name (`Bash`, `Skill`, `Agent`, …). */
  name: string;
  /** Full tool input, serialized JSON (small; powers skill/CLI detection). */
  inputJson: string;
};

/** A tool_result extracted from a `user` record, keyed by `tool_use_id`. */
export type ParsedToolResult = {
  toolUseId: string;
  /** Raw result text (serialized `toolUseResult`, or the block `content`). */
  resultText: string | null;
  isError: boolean;
};

/** A `pr-link` record → one `pr_link` row. */
export type ParsedPrLink = {
  prNumber: number | null;
  prUrl: string;
  prRepository: string | null;
};

/** A `system`/`turn_duration` record → one `turn_duration` row. */
export type ParsedTurnDuration = {
  durationMs: number;
  messageCount: number;
};

/**
 * The `Agent` tool spawn ledger, lifted from a parent `toolUseResult` that
 * carries an `agentId` (log-format §4). Links a sub-agent transcript file
 * (`agent-<agentId>.jsonl`) back to the spawning `tool_use` and supplies the
 * sub-agent's `agentType`/`resolvedModel`. The `totalTokens` aggregate is kept
 * ONLY as a cross-check against the transcript sum — never summed into totals.
 */
export type ParsedAgentSpawn = {
  agentId: string;
  /** The `tool_use_id` of the spawning `Agent` call (matches a tool_use block). */
  toolUseId: string | null;
  agentType: string | null;
  resolvedModel: string | null;
  /** Parent-aggregate token total — a cross-check, NOT added to any sum. */
  totalTokens: number | null;
};

/**
 * Classification of a user Message (GLOSSARY.md, Message). `null` on assistant
 * rows — they carry no meaningful kind. Decided by the record's `origin.kind`
 * first, then by the older rules (tool_result, `isMeta`) for records without
 * a recognized origin (log-format §8).
 *   - `prompt`            — text the human speaks: typed, or a plugin's `asUser` insert.
 *   - `inter-agent`       — text another Agent addressed to this one (`peer`, `coordinator`).
 *   - `task-notification` — a background task or Sub-agent stopped.
 *   - `tool-result`       — a tool_result carrier (the `extractToolResult` path).
 *   - `meta`              — a machine-injected record (`isMeta: true`): skill
 *     instructions, command output, system reminders.
 */
export type MessageKind = "prompt" | "inter-agent" | "task-notification" | "tool-result" | "meta";

/**
 * The normalized extras of a user Message — what its row needs beyond `kind`
 * and `text`, lifted from the log's `origin` (and a Task notification's XML).
 * NOT the raw log object: only these keys, each present only when it applies.
 * Stored as JSON in `message.origin` and validated with this schema when read.
 *
 * @example messageOriginSchema.safeParse(JSON.parse(row.origin))
 */
export const messageOriginSchema = z.object({
  /** Inter-agent sender's display name (`origin.name`: agent type or session name). */
  senderName: z.string().optional(),
  /** Inter-agent sender's address (`origin.from`): an agent type or id, or a socket path. */
  senderFrom: z.string().optional(),
  /** Agent id of a Sub-agent sender in this Conversation (`origin.senderTaskId`). */
  senderTaskId: z.string().optional(),
  /** The sender is the Agent that spawned this one (`origin.kind: coordinator`). */
  coordinator: z.literal(true).optional(),
  /** A hand-back: the Inter-agent message carrying a Sub-agent's final report. */
  handback: z.literal(true).optional(),
  /** Plugin that inserted this Prompt on the user's behalf. */
  plugin: z.string().optional(),
  /**
   * The message arrived while the Agent was working (GLOSSARY.md: "can arrive
   * while the Agent is working"). Semantic, not a record type: set for a
   * `queued_command` attachment AND for a user record in an exact mid-turn
   * delivery wrapper (see {@link COORDINATOR_MID_TURN_WRAPPER}).
   */
  midTurn: z.literal(true).optional(),
  /** Task notification: the stopped task's id (a Sub-agent's agent id for agent tasks). */
  taskId: z.string().optional(),
  /** Task notification: `completed`, `failed`, `killed`, `stopped`, … (absent for events). */
  taskStatus: z.string().optional(),
  /** Task notification: its one-line summary (`Agent "…" finished`). */
  taskSummary: z.string().optional(),
});

/** See {@link messageOriginSchema}. */
export type MessageOrigin = z.infer<typeof messageOriginSchema>;

/**
 * Exact delivery wrappers Claude Code puts around a message that arrived while
 * the Agent was working, in a `user` record's text — the rule is for `user`
 * records only (a `queued_command` keeps its wrapper in `rendered`, outside
 * `prompt`). One rule for both: an exact-match wrapper is stripped
 * and marks the message mid-turn; if the wording ever changes, the row degrades
 * to showing the wrapper (or, for an `isMeta` human record, to staying Meta) —
 * never to a wrong kind.
 */
const COORDINATOR_MID_TURN_WRAPPER = "The coordinator sent a message while you were working:\n";
/** See {@link COORDINATOR_MID_TURN_WRAPPER}. */
const USER_MID_TURN_WRAPPER = "The user sent a new message while you were working:\n";
/** The explanation Claude Code appends after a mid-turn user message; cut from here on. */
const USER_MID_TURN_TRAILER = "\n\nThis is how Claude Code surfaces messages the user sends mid-turn";

/** A user Message's classification, display body and extras. */
type ClassifiedUserMessage = {
  kind: MessageKind;
  text: string | null;
  origin: MessageOrigin | null;
};

/**
 * Classify a user Message by its log `origin` (record-level on a `user`
 * record, inside the attachment on a `queued_command`) before falling back to
 * the older rules: `commandMode: task-notification` (origin-less attachments),
 * then `isMeta`. Never throws: an unknown or malformed origin falls through.
 */
function classifyUserMessage(
  rawOrigin: unknown,
  isMeta: boolean,
  text: string | null,
  commandMode: unknown,
): ClassifiedUserMessage {
  const origin = isRecord(rawOrigin) ? rawOrigin : {};
  switch (origin.kind) {
    case "human": {
      if (!isMeta) return { kind: "prompt", text, origin: null };
      const inner = unwrap(text, USER_MID_TURN_WRAPPER);
      if (inner === null) return { kind: "meta", text, origin: null };
      const cut = inner.indexOf(USER_MID_TURN_TRAILER);
      return { kind: "prompt", text: cut === -1 ? inner : inner.slice(0, cut), origin: { midTurn: true } };
    }
    case "plugin":
      if (origin.asUser === true) {
        return { kind: "prompt", text, origin: compactOrigin({ plugin: asString(origin.name) }) };
      }
      break;
    case "peer": {
      const handback = origin.handback === true;
      const body = (handback ? asString(origin.handbackReportText) : null) ?? asString(origin.body) ?? text;
      return {
        kind: "inter-agent",
        text: body,
        origin: compactOrigin({
          senderName: asString(origin.name),
          senderFrom: asString(origin.from),
          senderTaskId: asString(origin.senderTaskId),
          handback: handback || null,
        }),
      };
    }
    case "coordinator": {
      const inner = unwrap(text, COORDINATOR_MID_TURN_WRAPPER);
      return {
        kind: "inter-agent",
        text: inner ?? text,
        origin: compactOrigin({ coordinator: true, midTurn: inner !== null || null }),
      };
    }
    case "task-notification":
      return parseTaskNotification(text);
  }
  if (commandMode === "task-notification") return parseTaskNotification(text);
  return { kind: isMeta ? "meta" : "prompt", text, origin: null };
}

/** `text` without its exact leading `wrapper`, or null when it does not start with it. */
function unwrap(text: string | null, wrapper: string): string | null {
  return text !== null && text.startsWith(wrapper) ? text.slice(wrapper.length) : null;
}

/** Drop absent (null/false) extras; null when nothing is left. */
function compactOrigin(fields: { [K in keyof MessageOrigin]?: MessageOrigin[K] | null }): MessageOrigin | null {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(fields)) {
    if (value !== null && value !== undefined) out[key] = value;
  }
  return Object.keys(out).length > 0 ? (out as MessageOrigin) : null;
}

/**
 * Read a Task notification's text (log-format §8): the first
 * `<task-notification>` block's `task-id`, `status`, `summary`, and `result`
 * (else a Monitor `event`) as the body, entity-decoded. Text without such a
 * block — "Background agent … was stopped by the user." — is all summary.
 */
function parseTaskNotification(text: string | null): ClassifiedUserMessage {
  const block = text === null ? undefined : /<task-notification>([\s\S]*?)<\/task-notification>/.exec(text)?.[1];
  if (block === undefined) {
    const summary = text?.replace(/<[^>]*>/g, "").trim();
    return { kind: "task-notification", text: null, origin: compactOrigin({ taskSummary: summary || null }) };
  }
  const tag = (name: string): string | null => {
    const value = new RegExp(`<${name}>([\\s\\S]*?)</${name}>`).exec(block)?.[1]?.trim();
    return value ? decodeEntities(value) : null;
  };
  return {
    kind: "task-notification",
    text: tag("result") ?? tag("event"),
    origin: compactOrigin({
      taskId: tag("task-id"),
      taskStatus: tag("status"),
      taskSummary: tag("summary") ?? (block.replace(/<[^>]*>/g, "").trim() || null),
    }),
  };
}

/** Decode the XML entities Claude Code escapes inside a notification's fields. */
function decodeEntities(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

/** Where Claude Code puts a repo's git worktrees, relative to the repo. */
const WORKTREES_DIR = "/.claude/worktrees/";

/**
 * The root of the git worktree of `repo` that `cwd` lies at or under
 * (`<repo>/.claude/worktrees/<name>`), or null when `cwd` is not inside one.
 */
function worktreeRootOf(repo: string, cwd: string): string | null {
  const prefix = repo.replace(/\/+$/, "") + WORKTREES_DIR;
  if (!cwd.startsWith(prefix)) return null;
  const name = cwd.slice(prefix.length).split("/")[0];
  return name === undefined || name.length === 0 ? null : prefix + name;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** A normalized message destined for one `message` row. */
export type ParsedMessage = {
  /** Dedup key: assistant `message.id`, else the record's `requestId`; null on user Messages. */
  messageId: string | null;
  /**
   * The assistant record's `requestRef` (2.1.300+), the first line's for a
   * turn split across lines: the `id` of the `api-request` record it answers.
   * Null on user Messages and older records.
   */
  requestRef: string | null;
  uuid: string | null;
  parentUuid: string | null;
  role: "user" | "assistant";
  /** User-record classification (see {@link MessageKind}); null for assistant. */
  kind: MessageKind | null;
  /** The display body: for an Inter-agent message or Task notification, without its wrapper. */
  text: string | null;
  /** User-Message extras (see {@link MessageOrigin}); null when there are none, and on assistant rows. */
  origin: MessageOrigin | null;
  /** `tool_use` blocks in this assistant turn (empty for user messages). */
  toolUses: ParsedToolUse[];
  /** Token split — null buckets for user messages (no usage of their own). */
  inputTokens: number | null;
  outputTokens: number | null;
  cacheCreation5mTokens: number | null;
  cacheCreation1hTokens: number | null;
  cacheReadTokens: number | null;
  model: string | null;
  attributionSkill: string | null;
  attributionAgent: string | null;
  attributionPlugin: string | null;
  attributionMcpServer: string | null;
  permissionMode: string | null;
  isApiError: boolean;
  /** apiErrorStatus captured as text (schema has no dedicated status column). */
  apiErrorMessage: string | null;
  /**
   * Reasoning effort level of this assistant turn, verbatim from the record's
   * TOP-LEVEL `effort` field (`high`, `xhigh`, `medium`, …). Null on user rows
   * and on turns from Claude Code versions that did not record it. Deliberately
   * an unconstrained string, NOT an enum: future levels must flow through
   * without a code change; classification happens at read time.
   */
  effort: string | null;
  /**
   * The text of this assistant turn's `thinking` blocks, joined in order
   * across its lines; null when every block is empty, on user rows, and on
   * turns without thinking (log-format §3, "Thinking").
   */
  thinkingText: string | null;
  /** The sum of this assistant turn's lines' `thinkingDurationMs`; null when none carries it, and on user rows. */
  thinkingDurationMs: number | null;
  /** Record timestamp in epoch ms (null when absent/unparseable). */
  timestamp: number | null;
};

/**
 * An `api-request` record (log-format §9): one API request the file's Agent
 * sent, as its `api_request` row keeps it.
 */
export type ParsedApiRequest = {
  /** The record's `id`, which an assistant record's `requestRef` names. */
  recordId: string;
  /** `base`; null when absent (`keep` is then 0). */
  baseRecordId: string | null;
  /** `keep`. */
  keptMessageCount: number;
  /** `tail`. */
  tailMessageHashes: string[];
  /** `params`, without `safeguards` (never stored, ADR-0007). */
  parameters: Record<string, unknown>;
  /** `cacheControl`: `[{path, value}]`. */
  cacheBreakpoints: unknown[];
  querySource: string | null;
  requestDigest: string | null;
  /** `timestamp` in epoch ms: when the request was sent. */
  sentAt: number | null;
  /** The hash of its system prompt: a key of `ParsedSession.systemPromptJsonByHash`; null without its shape. */
  systemPromptHash: string | null;
  /** The hash of its tool set: a key of `ParsedSession.toolSetJsonByHash`; null without its shape. */
  toolSetHash: string | null;
};

/** Per-session context fields, taken from the first record that carries them. */
export type ParsedSession = {
  /**
   * The Project path per the records (GLOSSARY.md, Project): the first record
   * `cwd`, unless a later `cwd` lies at or under a git worktree of it —
   * `<firstCwd>/.claude/worktrees/<name>` — in which case it is that worktree's
   * root, the last worktree visited winning. Any other `cd` (a subdirectory,
   * another directory) leaves it unchanged. Null when no record states a `cwd`.
   */
  projectPath: string | null;
  gitBranch: string | null;
  ccVersion: string | null;
  /** Resolved title per finding #7 precedence (custom > ai > first prompt > null). */
  title: string | null;
  /** Dominant model = the model with the most OUTPUT tokens (null if none). */
  dominantModel: string | null;
  messages: ParsedMessage[];
  /** Tool results keyed by `tool_use_id` (from `user` records). */
  toolResults: Map<string, ParsedToolResult>;
  /** `pr-link` records in the session. */
  prLinks: ParsedPrLink[];
  /** `system`/`turn_duration` records in the session. */
  turnDurations: ParsedTurnDuration[];
  /** `Agent` spawn ledgers keyed by spawned `agentId` (cross-check + linkage). */
  agentSpawns: Map<string, ParsedAgentSpawn>;
  /** The `api-request` records, in file order (log-format §9). */
  apiRequests: ParsedApiRequest[];
  /** Each distinct system prompt of the file's shapes, as logged (JSON), by the sha256 of its canonical JSON. */
  systemPromptJsonByHash: Map<string, string>;
  /** Each distinct tool set of the file's shapes, as logged (JSON), by the sha256 of its canonical JSON. */
  toolSetJsonByHash: Map<string, string>;
  /**
   * Each message a `tail` of the file names that the file can rebuild — from
   * a blob, else from its own records (log-format §9, step 2) — as logged
   * (JSON), by that hash.
   */
  sentMessageJsonByHash: Map<string, string>;
  malformedLines: number;
};

/** A `content` block in an assistant/user message. */
type ContentBlock =
  | { type: "text"; text?: string }
  | { type: "thinking"; thinking?: string; signature?: string }
  | { type: "tool_use"; id?: string; name?: string; input?: unknown }
  | { type: "tool_result"; tool_use_id?: string; is_error?: boolean; content?: unknown }
  | { type: string; [k: string]: unknown };

/** A `usage` object as the API reports it, every bucket optional. */
type RawUsage = {
  input_tokens?: number;
  output_tokens?: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
  cache_creation?: {
    ephemeral_5m_input_tokens?: number;
    ephemeral_1h_input_tokens?: number;
  };
};

/**
 * Extract human-readable text from a `message.content` union (finding #2): a
 * plain string, or an array of blocks. Only `text` blocks contribute; `thinking`
 * text is the Turn's thinking (see {@link extractThinkingText}) and `tool_use`
 * is not text. Multiple text blocks are joined with newlines.
 */
export function extractText(content: unknown): string | null {
  if (typeof content === "string") {
    return content.length > 0 ? content : null;
  }
  if (Array.isArray(content)) {
    const parts: string[] = [];
    for (const block of content as ContentBlock[]) {
      if (block && block.type === "text" && typeof block.text === "string") {
        parts.push(block.text);
      }
    }
    return parts.length > 0 ? parts.join("\n") : null;
  }
  return null;
}

/**
 * The non-empty `thinking` texts of a `message.content` array, joined with
 * newlines as {@link extractText} joins text; null when it has none — an
 * empty `thinking` block, the norm (log-format §3, "Thinking"), contributes nothing.
 */
function extractThinkingText(content: unknown): string | null {
  if (!Array.isArray(content)) return null;
  const parts: string[] = [];
  for (const block of content as ContentBlock[]) {
    if (block && block.type === "thinking" && typeof block.thinking === "string" && block.thinking.length > 0) {
      parts.push(block.thinking);
    }
  }
  return parts.length > 0 ? parts.join("\n") : null;
}

/** Join two optional texts of one Turn with a newline, in order: null only when both are. */
function joinTurnTexts(earlier: string | null, later: string | null): string | null {
  if (earlier === null) return later;
  return later === null ? earlier : `${earlier}\n${later}`;
}

/** Add two optional durations of one Turn: null only when both are. */
function sumTurnDurations(earlierMs: number | null, laterMs: number | null): number | null {
  if (earlierMs === null) return laterMs;
  return laterMs === null ? earlierMs : earlierMs + laterMs;
}

/**
 * Lift `tool_use` blocks out of a `message.content` array (finding #6). Each
 * becomes one `tool_call` row. The full `input` is serialized as JSON — small,
 * and the canonical signal for skill/CLI detection (`Bash.command`,
 * `Skill.skill`, `Agent.subagent_type`, …); we do not over-model per tool.
 */
export function extractToolUseBlocks(content: unknown): ParsedToolUse[] {
  if (!Array.isArray(content)) return [];
  const out: ParsedToolUse[] = [];
  for (const block of content as ContentBlock[]) {
    if (block && block.type === "tool_use") {
      const b = block as { id?: string; name?: string; input?: unknown };
      out.push({
        toolUseId: asString(b.id),
        name: asString(b.name) ?? "unknown",
        inputJson: JSON.stringify(b.input ?? {}),
      });
    }
  }
  return out;
}

/**
 * Extract a `tool_result` from a `user` record (finding #6). The result lives in
 * the record-level `toolUseResult` field (shape varies per tool — Bash → stdout,
 * Agent → the sub-agent ledger); we serialize it raw and keep the matching
 * `tool_use_id`/`is_error` from the content block.
 */
function extractToolResult(record: Record<string, unknown>, content: unknown): ParsedToolResult | null {
  if (!Array.isArray(content)) return null;
  for (const block of content as ContentBlock[]) {
    if (block && block.type === "tool_result") {
      const b = block as { tool_use_id?: string; is_error?: boolean; content?: unknown };
      const toolUseId = asString(b.tool_use_id);
      if (toolUseId === null) continue;
      const raw = record.toolUseResult;
      const resultText =
        raw === undefined || raw === null
          ? extractText(b.content)
          : typeof raw === "string"
            ? raw
            : JSON.stringify(raw);
      return { toolUseId, resultText, isError: b.is_error === true };
    }
  }
  return null;
}

/**
 * If a `user` record's `toolUseResult` carries an `agentId`, lift the sub-agent
 * spawn ledger (log-format §4). The `agentId` links to the `agent-<id>.jsonl`
 * transcript; `toolUseId` links to the spawning `Agent` tool_use. `totalTokens`
 * is a CROSS-CHECK against the transcript sum (GOTCHA 3) — never added anywhere.
 */
function extractAgentSpawn(record: Record<string, unknown>, toolUseId: string): ParsedAgentSpawn | null {
  const raw = record.toolUseResult;
  if (raw === null || typeof raw !== "object") return null;
  const tur = raw as Record<string, unknown>;
  const agentId = asString(tur.agentId);
  if (agentId === null) return null;
  const usage = tur.usage as RawUsage | undefined;
  return {
    agentId,
    toolUseId,
    agentType: asString(tur.agentType),
    resolvedModel: asString(tur.resolvedModel),
    totalTokens: asInteger(tur.totalTokens) ?? (usage === undefined ? null : sumUsageTokens(usage)),
  };
}

/** Sum every token bucket of a raw `usage` (the parent-aggregate cross-check). */
function sumUsageTokens(usage: RawUsage): number {
  const s = parseUsage(usage);
  return s.inputTokens + s.outputTokens + s.cacheCreation5mTokens + s.cacheCreation1hTokens + s.cacheReadTokens;
}

/**
 * Parse a `usage` object — a log Turn's, or an API response's — into the
 * per-tier split the `message` and `api_request` columns store (finding #3
 * cache math); every absent bucket is 0.
 *
 * @example const { inputTokens, cacheCreation1hTokens } = parseUsage(message.usage as RawUsage | undefined);
 */
function parseUsage(usage: RawUsage | undefined): {
  inputTokens: number;
  outputTokens: number;
  cacheCreation5mTokens: number;
  cacheCreation1hTokens: number;
  cacheReadTokens: number;
} {
  const cc = usage?.cache_creation;
  return {
    inputTokens: asInteger(usage?.input_tokens) ?? 0,
    outputTokens: asInteger(usage?.output_tokens) ?? 0,
    // The top-level cache_creation_input_tokens is the SUM of these two tiers
    // (finding #3); we store the tiers, never the sum, to avoid double counting.
    cacheCreation5mTokens: asInteger(cc?.ephemeral_5m_input_tokens) ?? 0,
    cacheCreation1hTokens: asInteger(cc?.ephemeral_1h_input_tokens) ?? 0,
    cacheReadTokens: asInteger(usage?.cache_read_input_tokens) ?? 0,
  };
}

function toEpochMs(ts: unknown): number | null {
  if (typeof ts !== "string") return null;
  const ms = Date.parse(ts);
  return Number.isNaN(ms) ? null : ms;
}

function asString(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}

/**
 * The value if it is an integer, else null. Every log number bound for an
 * integer column goes through here: a fraction or a string is treated as missing.
 */
function asInteger(v: unknown): number | null {
  return Number.isInteger(v) ? (v as number) : null;
}

/**
 * What every line of a request record holds (`api-request`, `-shape`, `-blob`),
 * as Claude Code writes it: a file without it has none. A record that merely
 * quotes it only costs that file the hashing of its records.
 */
const REQUEST_RECORD_TYPE_MARK = '"type":"api-request';

/**
 * Parse the lines of one session file into a `ParsedSession`. Assistant turns are
 * split by Claude Code across several JSONL lines sharing one `message.id` — one
 * per content block (finding #4) — so records with a repeated id are MERGED into
 * a single message (text concatenated, all tool_use blocks collected) with the
 * usage, repeated identically across those records, counted once.
 */
export function parseSessionLines(lines: readonly string[]): ParsedSession {
  const messages: ParsedMessage[] = [];
  const toolResults = new Map<string, ParsedToolResult>();
  const prLinks: ParsedPrLink[] = [];
  const turnDurations: ParsedTurnDuration[] = [];
  const agentSpawns = new Map<string, ParsedAgentSpawn>();
  // Assistant turns already emitted, keyed by message.id, so later content-block
  // records for the same turn merge into the existing message (see below).
  const assistantById = new Map<string, ParsedMessage>();
  const deliveries = deliveryLedger();
  const apiRequests: { request: ParsedApiRequest; shapeHash: string | null }[] = [];
  const requestShapes = requestShapeLedger();
  // Only a file with request records (2.1.300+) has messages to rebuild:
  // the others, most files, skip hashing their records.
  const sentMessages = sentMessageLedger(lines.some((line) => line.includes(REQUEST_RECORD_TYPE_MARK)));
  let malformedLines = 0;

  let firstCwd: string | null = null;
  let worktreeRoot: string | null = null;
  let gitBranch: string | null = null;
  let ccVersion: string | null = null;
  let aiTitle: string | null = null;
  let customTitle: string | null = null;
  let firstUserText: string | null = null;

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;

    let record: Record<string, unknown>;
    try {
      record = JSON.parse(trimmed) as Record<string, unknown>;
    } catch {
      malformedLines += 1;
      continue;
    }

    const type = record.type;

    if (type === "ai-title") {
      aiTitle ??= asString(record.aiTitle);
      continue;
    }
    if (type === "custom-title") {
      customTitle ??= asString(record.customTitle);
      continue;
    }

    if (type === "pr-link") {
      const prUrl = asString(record.prUrl);
      if (prUrl !== null) {
        prLinks.push({
          prNumber: asInteger(record.prNumber),
          prUrl,
          prRepository: asString(record.prRepository),
        });
      }
      continue;
    }

    if (type === "system") {
      if (record.subtype === "turn_duration") {
        turnDurations.push({
          durationMs: asInteger(record.durationMs) ?? 0,
          messageCount: asInteger(record.messageCount) ?? 0,
        });
      }
      continue; // other system subtypes (compaction, retries) not modeled.
    }

    if (type === "api-request") {
      const apiRequest = parseApiRequest(record);
      if (apiRequest !== null) {
        apiRequests.push(apiRequest);
        sentMessages.addTail(apiRequest.request.tailMessageHashes);
      }
      continue;
    }
    if (type === "api-request-shape") {
      requestShapes.add(record);
      continue;
    }
    if (type === "api-request-blob") {
      sentMessages.addBlob(record);
      continue;
    }

    if (type === "attachment") {
      const queued = parseQueuedCommand(record);
      if (queued !== null && !deliveries.seen(queued.keys)) {
        deliveries.add(queued.keys);
        if (queued.message.kind === "prompt") firstUserText ??= queued.message.text;
        messages.push(queued.message);
      }
      continue; // other attachment types (files, images) are skipped (log-format §6).
    }

    if (type !== "assistant" && type !== "user") {
      continue; // mode/etc. skipped gracefully (log-format §6).
    }

    // Per-record context fields (finding #10) — take the first non-null seen;
    // a later `cwd` only matters when it enters a worktree of the first.
    const cwd = asString(record.cwd);
    firstCwd ??= cwd;
    if (cwd !== null && firstCwd !== null) worktreeRoot = worktreeRootOf(firstCwd, cwd) ?? worktreeRoot;
    gitBranch ??= asString(record.gitBranch);
    ccVersion ??= asString(record.version);

    const message = (record.message ?? {}) as Record<string, unknown>;
    const text = extractText(message.content);

    if (type === "user") {
      const toolResult = extractToolResult(record, message.content);
      // A tool_result carrier is machinery whatever its origin; every other
      // user record is classified by origin (see `classifyUserMessage`).
      let classified: ClassifiedUserMessage;
      if (toolResult !== null) {
        classified = { kind: "tool-result", text, origin: null };
        toolResults.set(toolResult.toolUseId, toolResult);
        const spawn = extractAgentSpawn(record, toolResult.toolUseId);
        if (spawn !== null) agentSpawns.set(spawn.agentId, spawn);
      } else {
        classified = classifyUserMessage(record.origin, record.isMeta === true, text, undefined);
      }
      // Only a Prompt — the human speaking — seeds the title fallback.
      if (classified.kind === "prompt") firstUserText ??= classified.text;
      deliveries.add(deliveryKeys(record.origin, null));
      messages.push(userMessage(record, classified, toEpochMs(record.timestamp)));
      sentMessages.addRecord("user", record, trimmed);
      continue;
    }
    sentMessages.addRecord("assistant", record, trimmed);

    // assistant — records sharing a message.id are ONE turn that Claude Code
    // split across content-block lines (a `thinking` line, a `text` line, then
    // a `tool_use` line, …), each repeating the identical `usage` (finding #4).
    // MERGE them: append every line's text + tool_use blocks onto the turn
    // already built, and take usage/model/timestamp from the first line only
    // (never summed). Keeping just the first line would drop the body and tool
    // calls of a thinking-first turn, surfacing as empty assistant rows.
    // Thinking merges like text, its duration summed: a turn with two thinking
    // lines logs a `thinkingDurationMs` on each, the second a few ms.
    const messageId = asString(message.id) ?? asString(record.requestId);
    const blockToolUses = extractToolUseBlocks(message.content);
    const thinkingText = extractThinkingText(message.content);
    const thinkingDurationMs = asInteger(record.thinkingDurationMs);

    if (messageId !== null) {
      const existing = assistantById.get(messageId);
      if (existing !== undefined) {
        existing.text = joinTurnTexts(existing.text, text);
        existing.thinkingText = joinTurnTexts(existing.thinkingText, thinkingText);
        existing.thinkingDurationMs = sumTurnDurations(existing.thinkingDurationMs, thinkingDurationMs);
        existing.toolUses.push(...blockToolUses);
        continue;
      }
    }

    const usage = parseUsage(message.usage as RawUsage | undefined);
    const parsed: ParsedMessage = {
      messageId,
      requestRef: asString(record.requestRef),
      uuid: asString(record.uuid),
      parentUuid: asString(record.parentUuid),
      role: "assistant",
      kind: null,
      text,
      origin: null,
      toolUses: blockToolUses,
      ...usage,
      model: asString(message.model),
      attributionSkill: asString(record.attributionSkill),
      attributionAgent: asString(record.attributionAgent),
      attributionPlugin: asString(record.attributionPlugin),
      attributionMcpServer: asString(record.attributionMcpServer),
      permissionMode: asString(record.permissionMode),
      isApiError: record.isApiErrorMessage === true,
      apiErrorMessage: asString(record.apiErrorStatus),
      // Top-level field, NOT inside `message`. Later lines of the same turn are
      // merged above, so the first line's effort wins — as it does for usage.
      effort: asString(record.effort),
      thinkingText,
      thinkingDurationMs,
      timestamp: toEpochMs(record.timestamp),
    };
    messages.push(parsed);
    if (messageId !== null) assistantById.set(messageId, parsed);
  }

  // Title precedence (finding #7): custom > ai > first user prompt > null.
  const title = customTitle ?? aiTitle ?? firstUserText ?? null;

  return {
    projectPath: worktreeRoot ?? firstCwd,
    gitBranch,
    ccVersion,
    title,
    dominantModel: pickDominantModel(messages),
    messages,
    toolResults,
    prLinks,
    turnDurations,
    agentSpawns,
    // Resolved once the whole file is read: a shape need not precede its requests.
    apiRequests: apiRequests.map(({ request, shapeHash }) => ({
      ...request,
      ...requestShapes.pieceHashesOf(shapeHash),
    })),
    systemPromptJsonByHash: requestShapes.systemPromptJsonByHash,
    toolSetJsonByHash: requestShapes.toolSetJsonByHash,
    sentMessageJsonByHash: sentMessages.namedJsonByHash(),
    malformedLines,
  };
}

/**
 * An `api-request` record as its row keeps it, with the `shapeHash` that
 * locates its system prompt and tool set; null without an `id`.
 */
function parseApiRequest(
  record: Record<string, unknown>,
): { request: ParsedApiRequest; shapeHash: string | null } | null {
  const recordId = asString(record.id);
  if (recordId === null) return null;
  const parameters = isRecord(record.params) ? { ...record.params } : {};
  delete parameters.safeguards;
  return {
    request: {
      recordId,
      baseRecordId: asString(record.base),
      keptMessageCount: asInteger(record.keep) ?? 0,
      tailMessageHashes: Array.isArray(record.tail)
        ? record.tail.filter((hash): hash is string => typeof hash === "string")
        : [],
      parameters,
      cacheBreakpoints: Array.isArray(record.cacheControl) ? record.cacheControl : [],
      querySource: asString(record.querySource),
      requestDigest: asString(record.requestDigest),
      sentAt: toEpochMs(record.timestamp),
      systemPromptHash: null,
      toolSetHash: null,
    },
    shapeHash: asString(record.shapeHash),
  };
}

/**
 * The `api-request-shape` records of one file, each reduced as it is read to
 * the hashes of its system prompt and tool set — the sha256 of their canonical
 * JSON — with each distinct piece kept once, as logged (the smallest of its spellings).
 */
function requestShapeLedger() {
  const pieceHashesByShapeHash = new Map<string, { systemPromptHash: string; toolSetHash: string }>();
  const systemPromptJsonByHash = new Map<string, string>();
  const toolSetJsonByHash = new Map<string, string>();
  /** The hash of `piece`, kept in `jsonByHash` as logged — of two spellings of one piece, the smallest. */
  const keep = (piece: unknown, jsonByHash: Map<string, string>): string => {
    const hash = createHash("sha256").update(canonicalJson(piece)).digest("hex");
    const json = JSON.stringify(piece);
    const keptJson = jsonByHash.get(hash);
    if (keptJson === undefined || json < keptJson) jsonByHash.set(hash, json);
    return hash;
  };
  return {
    systemPromptJsonByHash,
    toolSetJsonByHash,
    add: (record: Record<string, unknown>) => {
      const shapeHash = asString(record.shapeHash);
      if (shapeHash === null || !isRecord(record.shape) || pieceHashesByShapeHash.has(shapeHash)) return;
      pieceHashesByShapeHash.set(shapeHash, {
        systemPromptHash: keep(record.shape.system ?? [], systemPromptJsonByHash),
        toolSetHash: keep(record.shape.tools ?? [], toolSetJsonByHash),
      });
    },
    /** The piece hashes of the shape stored under `shapeHash`; both null when the file holds none. */
    pieceHashesOf: (shapeHash: string | null) =>
      (shapeHash === null ? undefined : pieceHashesByShapeHash.get(shapeHash)) ?? {
        systemPromptHash: null,
        toolSetHash: null,
      },
  };
}

/**
 * The messages of one file's request records (log-format §9): the hashes its
 * tails name, and each message it can rebuild, kept until the whole file is
 * read — a blob may follow the request that sent it — and then only those a
 * tail names.
 */
function sentMessageLedger(isRebuildingFromRecords: boolean) {
  const namedHashes = new Set<string>();
  const blobJsonByHash = new Map<string, string>();
  /** Each message the file's records rebuild, by its hash: the records of it, kept as their lines until a tail is known to name it. */
  const rebuiltSourceByHash = new Map<string, RebuiltMessageSource>();
  let userRun: RebuiltMessageDraft | null = null;
  const assistantDraftByMessageId = new Map<string, RebuiltMessageDraft>();
  const assistantDrafts: RebuiltMessageDraft[] = [];
  const keepFirst = (hash: string, source: RebuiltMessageSource) => {
    if (!rebuiltSourceByHash.has(hash)) rebuiltSourceByHash.set(hash, source);
  };
  return {
    /**
     * A `user` or `assistant` record, from `line`: a user record joins the run
     * of user records since the last assistant one, each leading part of the
     * run a message; an assistant record joins the other records of its
     * `message.id`. Ignored in a file without request records.
     */
    addRecord: (role: "user" | "assistant", record: Record<string, unknown>, line: string) => {
      if (!isRebuildingFromRecords) return;
      const content = isRecord(record.message) ? record.message.content : undefined;
      if (role === "user") {
        userRun ??= rebuiltMessageDraft("user");
        userRun.add(content, line);
        keepFirst(userRun.hash(), { role, lines: userRun.lines, recordCount: userRun.lines.length });
        return;
      }
      userRun = null;
      const messageId = isRecord(record.message) ? asString(record.message.id) : null;
      let draft = messageId === null ? undefined : assistantDraftByMessageId.get(messageId);
      if (draft === undefined) {
        draft = rebuiltMessageDraft("assistant");
        assistantDrafts.push(draft);
        if (messageId !== null) assistantDraftByMessageId.set(messageId, draft);
      }
      draft.add(content, line);
    },
    addTail: (tailMessageHashes: string[]) => {
      for (const hash of tailMessageHashes) namedHashes.add(hash);
    },
    /** A blob, under the hash it is logged with (the one a tail names): of two spellings, the smallest. */
    addBlob: (record: Record<string, unknown>) => {
      const hash = asString(record.hash);
      if (hash === null || !isRecord(record.message)) return;
      const json = JSON.stringify(record.message);
      const keptJson = blobJsonByHash.get(hash);
      if (keptJson === undefined || json < keptJson) blobJsonByHash.set(hash, json);
    },
    /** Each message a tail names that the file holds, by its hash: from a blob, else rebuilt from its records. */
    namedJsonByHash: (): Map<string, string> => {
      for (const draft of assistantDrafts) {
        keepFirst(draft.hash(), { role: "assistant", lines: draft.lines, recordCount: draft.lines.length });
      }
      const jsonByHash = new Map<string, string>();
      for (const hash of namedHashes) {
        const blobJson = blobJsonByHash.get(hash);
        const source = blobJson === undefined ? rebuiltSourceByHash.get(hash) : undefined;
        const json = blobJson ?? (source === undefined ? undefined : rebuiltMessageJson(source));
        if (json !== undefined) jsonByHash.set(hash, json);
      }
      return jsonByHash;
    },
  };
}

/** The records a message is rebuilt from: the first `recordCount` of `lines`. */
type RebuiltMessageSource = { role: "user" | "assistant"; lines: string[]; recordCount: number };

/** How a rebuilt message's canonical JSON starts: `content`, its blocks, sorts before `role`. */
const REBUILT_MESSAGE_JSON_START = '{"content":[';

/**
 * A message being rebuilt from consecutive records (log-format §9, step 2):
 * their lines, and the sha256 of its canonical JSON fed block by block, so
 * the hash of the message as it stands costs one copy, whatever its size.
 */
type RebuiltMessageDraft = {
  lines: string[];
  add: (content: unknown, line: string) => void;
  /** The hash of the message made of every record added so far. */
  hash: () => string;
};

function rebuiltMessageDraft(role: "user" | "assistant"): RebuiltMessageDraft {
  const contentHash = createHash("sha256").update(REBUILT_MESSAGE_JSON_START);
  const lines: string[] = [];
  let blockCount = 0;
  const end = `],"role":${JSON.stringify(role)}}`;
  return {
    lines,
    add: (content, line) => {
      lines.push(line);
      for (const block of contentBlocksOf(content)) {
        contentHash.update(blockCount === 0 ? canonicalJson(block) : `,${canonicalJson(block)}`);
        blockCount += 1;
      }
    },
    hash: () => contentHash.copy().update(end).digest("hex"),
  };
}

/** A message's `content` as blocks: a string is one text block, a missing content none. */
function contentBlocksOf(content: unknown): unknown[] {
  if (typeof content === "string") return [{ type: "text", text: content }];
  return Array.isArray(content) ? content : [];
}

/**
 * The message `source` rebuilds, as logged: one record's `content` as it is
 * (a string kept), several records' blocks concatenated in order.
 */
function rebuiltMessageJson(source: RebuiltMessageSource): string {
  const contents = source.lines.slice(0, source.recordCount).map((line) => {
    const record = JSON.parse(line) as Record<string, unknown>;
    return isRecord(record.message) ? record.message.content : undefined;
  });
  const content = contents.length === 1 ? (contents[0] ?? []) : contents.flatMap(contentBlocksOf);
  return JSON.stringify({ role: source.role, content });
}

/**
 * A `queued_command` attachment (log-format §8): a Prompt, Inter-agent message
 * or Task notification delivered while the Agent was working. Classified like
 * a user record from the attachment's own `origin`/`isMeta`/`commandMode`, and
 * timestamped from the attachment (else the record). Null for any other
 * attachment, or one without prompt text.
 */
function parseQueuedCommand(record: Record<string, unknown>): { message: ParsedMessage; keys: string[] } | null {
  const attachment = record.attachment;
  if (!isRecord(attachment) || attachment.type !== "queued_command") return null;
  const text = extractText(attachment.prompt);
  if (text === null) return null;
  // A human-origin attachment is a Prompt whatever its `isMeta`: the mid-turn
  // wrapper lives in the record's `rendered`, and `prompt` is the bare text.
  const human = isRecord(attachment.origin) && attachment.origin.kind === "human";
  const isMeta = attachment.isMeta === true && !human;
  const classified = classifyUserMessage(attachment.origin, isMeta, text, attachment.commandMode);
  if (classified.kind === "prompt" || classified.kind === "inter-agent") {
    classified.origin = { ...classified.origin, midTurn: true };
  }
  const timestamp = toEpochMs(attachment.timestamp) ?? toEpochMs(record.timestamp);
  return {
    message: userMessage(record, classified, timestamp),
    keys: deliveryKeys(attachment.origin, attachment.source_uuid),
  };
}

/** The ids that identify one delivered message: the queue's `source_uuid`, a peer's `origin.msg_id`. */
function deliveryKeys(origin: unknown, sourceUuid: unknown): string[] {
  const keys: string[] = [];
  const source = asString(sourceUuid);
  if (source !== null) keys.push(`source:${source}`);
  const msgId = isRecord(origin) ? asString(origin.msg_id) : null;
  if (msgId !== null) keys.push(`msg:${msgId}`);
  return keys;
}

/**
 * The delivery ids of the messages kept so far, so an attachment repeating
 * one already kept — by `source_uuid` or peer `msg_id`, never by text or time —
 * is dropped.
 */
function deliveryLedger() {
  const kept = new Set<string>();
  return {
    seen: (keys: string[]) => keys.some((k) => kept.has(k)),
    add: (keys: string[]) => {
      for (const k of keys) kept.add(k);
    },
  };
}

/** The `message` row of a user Message (a `user` record or a `queued_command` attachment). */
function userMessage(
  record: Record<string, unknown>,
  classified: ClassifiedUserMessage,
  timestamp: number | null,
): ParsedMessage {
  return {
    messageId: null,
    requestRef: null,
    uuid: asString(record.uuid),
    parentUuid: asString(record.parentUuid),
    role: "user",
    ...classified,
    toolUses: [],
    inputTokens: null,
    outputTokens: null,
    cacheCreation5mTokens: null,
    cacheCreation1hTokens: null,
    cacheReadTokens: null,
    model: null,
    attributionSkill: null,
    attributionAgent: null,
    attributionPlugin: null,
    attributionMcpServer: null,
    permissionMode: asString(record.permissionMode),
    isApiError: false,
    apiErrorMessage: null,
    effort: null, // a user record has no reasoning effort of its own.
    thinkingText: null,
    thinkingDurationMs: null,
    timestamp,
  };
}

/** Dominant model = the model with the most OUTPUT tokens across assistant turns. */
export function pickDominantModel(messages: ParsedMessage[]): string | null {
  const outputByModel = new Map<string, number>();
  for (const m of messages) {
    if (m.model === null) continue;
    outputByModel.set(m.model, (outputByModel.get(m.model) ?? 0) + (m.outputTokens ?? 0));
  }
  let best: string | null = null;
  let bestOutput = -1;
  for (const [model, output] of outputByModel) {
    // Strict `>` keeps the first-inserted (earliest-seen) model on a tie.
    if (output > bestOutput) {
      best = model;
      bestOutput = output;
    }
  }
  return best;
}
