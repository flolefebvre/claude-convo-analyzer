// JSONL session parser (findings #2,#3,#4,#7,#8,#10). Reads one session file's
// lines into a typed, deduplicated `ParsedSession` ready for DB write.
//
// SLICE SCOPE: handles `assistant`, `user` (incl. tool_result), `ai-title`,
// `custom-title`, `pr-link`, `system`/`turn_duration`, and `queued_command`
// attachments (mid-turn user Messages); tool_use blocks and `Agent` spawn
// ledgers are lifted too. Other record types are skipped gracefully
// (log-format §6). A line that fails JSON.parse is skipped and counted (never fatal).
//
// EXTENSION POINTS:
//   - `parseSessionLines` is the single dispatch site over record `type`; add new
//     branches there. The same routine parses a sub-agent transcript (it is the
//     same per-turn shape — GLOSSARY.md), so refresh reuses it directly for subs.
//   - `extractText` / `extractToolUseBlocks` decode the `content` union once.
//   - `ParsedMessage` already carries `uuid`/`parentUuid` so Slice 4 can build the
//     message-uuid index for continued-from resolution.

import { z } from "zod";

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

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** A normalized message destined for one `message` row. */
export type ParsedMessage = {
  /** Dedup key: assistant `message.id` (== requestId); user records use `uuid`. */
  messageId: string | null;
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
  /** Record timestamp in epoch ms (null when absent/unparseable). */
  timestamp: number | null;
};

/** Per-session context fields, taken from the first record that carries them. */
export type ParsedSession = {
  /** Authoritative project path from a record `cwd` (null ⇒ fall back to folder). */
  cwd: string | null;
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
  malformedLines: number;
};

/** A `content` block in an assistant/user message. */
type ContentBlock =
  | { type: "text"; text?: string }
  | { type: "thinking"; thinking?: string; signature?: string }
  | { type: "tool_use"; id?: string; name?: string; input?: unknown }
  | { type: "tool_result"; tool_use_id?: string; is_error?: boolean; content?: unknown }
  | { type: string; [k: string]: unknown };

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
 * text is unavailable (finding #8) and `tool_use` is not text. Multiple text
 * blocks are joined with newlines.
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
    totalTokens:
      typeof tur.totalTokens === "number" ? tur.totalTokens : usage === undefined ? null : sumUsageTokens(usage),
  };
}

/** Sum every token bucket of a raw `usage` (the parent-aggregate cross-check). */
function sumUsageTokens(usage: RawUsage): number {
  const s = parseUsage(usage);
  return s.inputTokens + s.outputTokens + s.cacheCreation5mTokens + s.cacheCreation1hTokens + s.cacheReadTokens;
}

/** Parse a `usage` object into the per-tier split (finding #3 cache math). */
function parseUsage(usage: RawUsage | undefined): {
  inputTokens: number;
  outputTokens: number;
  cacheCreation5mTokens: number;
  cacheCreation1hTokens: number;
  cacheReadTokens: number;
} {
  const cc = usage?.cache_creation;
  return {
    inputTokens: usage?.input_tokens ?? 0,
    outputTokens: usage?.output_tokens ?? 0,
    // The top-level cache_creation_input_tokens is the SUM of these two tiers
    // (finding #3); we store the tiers, never the sum, to avoid double counting.
    cacheCreation5mTokens: cc?.ephemeral_5m_input_tokens ?? 0,
    cacheCreation1hTokens: cc?.ephemeral_1h_input_tokens ?? 0,
    cacheReadTokens: usage?.cache_read_input_tokens ?? 0,
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
 * Parse the lines of one session file into a `ParsedSession`. Assistant turns are
 * split by Claude Code across several JSONL lines sharing one `message.id` — one
 * per content block (finding #4) — so records with a repeated id are MERGED into
 * a single message (text concatenated, all tool_use blocks collected) with the
 * usage, repeated identically across those records, counted once.
 */
export function parseSessionLines(lines: Iterable<string>): ParsedSession {
  const messages: ParsedMessage[] = [];
  const toolResults = new Map<string, ParsedToolResult>();
  const prLinks: ParsedPrLink[] = [];
  const turnDurations: ParsedTurnDuration[] = [];
  const agentSpawns = new Map<string, ParsedAgentSpawn>();
  // Assistant turns already emitted, keyed by message.id, so later content-block
  // records for the same turn merge into the existing message (see below).
  const assistantById = new Map<string, ParsedMessage>();
  const deliveries = deliveryLedger();
  let malformedLines = 0;

  let cwd: string | null = null;
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
          prNumber: typeof record.prNumber === "number" ? record.prNumber : null,
          prUrl,
          prRepository: asString(record.prRepository),
        });
      }
      continue;
    }

    if (type === "system") {
      if (record.subtype === "turn_duration") {
        turnDurations.push({
          durationMs: typeof record.durationMs === "number" ? record.durationMs : 0,
          messageCount: typeof record.messageCount === "number" ? record.messageCount : 0,
        });
      }
      continue; // other system subtypes (compaction, retries) not modeled.
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

    // Per-record context fields (finding #10) — take the first non-null seen.
    cwd ??= asString(record.cwd);
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
      continue;
    }

    // assistant — records sharing a message.id are ONE turn that Claude Code
    // split across content-block lines (a `thinking` line, a `text` line, then
    // a `tool_use` line, …), each repeating the identical `usage` (finding #4).
    // MERGE them: append every line's text + tool_use blocks onto the turn
    // already built, and take usage/model/timestamp from the first line only
    // (never summed). Keeping just the first line would drop the body and tool
    // calls of a thinking-first turn, surfacing as empty assistant rows.
    const messageId = asString(message.id) ?? asString(record.requestId);
    const blockToolUses = extractToolUseBlocks(message.content);

    if (messageId !== null) {
      const existing = assistantById.get(messageId);
      if (existing !== undefined) {
        if (text !== null) {
          existing.text = existing.text === null ? text : `${existing.text}\n${text}`;
        }
        existing.toolUses.push(...blockToolUses);
        continue;
      }
    }

    const usage = parseUsage(message.usage as RawUsage | undefined);
    const parsed: ParsedMessage = {
      messageId,
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
      timestamp: toEpochMs(record.timestamp),
    };
    messages.push(parsed);
    if (messageId !== null) assistantById.set(messageId, parsed);
  }

  // Title precedence (finding #7): custom > ai > first user prompt > null.
  const title = customTitle ?? aiTitle ?? firstUserText ?? null;

  return {
    cwd,
    gitBranch,
    ccVersion,
    title,
    dominantModel: pickDominantModel(messages),
    messages,
    toolResults,
    prLinks,
    turnDurations,
    agentSpawns,
    malformedLines,
  };
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
