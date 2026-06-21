// JSONL session parser (findings #2,#3,#4,#7,#8,#10). Reads one session file's
// lines into a typed, deduplicated `ParsedSession` ready for DB write.
//
// SLICE SCOPE: handles `assistant`, `user` (incl. tool_result), `ai-title`,
// `custom-title`, `pr-link`, and `system`/`turn_duration`; tool_use blocks and
// `Agent` spawn ledgers are lifted too. Other record types are skipped gracefully
// (log-format §6). A line that fails JSON.parse is skipped and counted (never fatal).
//
// EXTENSION POINTS:
//   - `parseSessionLines` is the single dispatch site over record `type`; add new
//     branches there. The same routine parses a sub-agent transcript (it is the
//     same per-turn shape — CONTEXT.md), so refresh reuses it directly for subs.
//   - `extractText` / `extractToolUseBlocks` decode the `content` union once.
//   - `ParsedMessage` already carries `uuid`/`parentUuid` so Slice 4 can build the
//     message-uuid index for continued-from resolution.

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

/** A normalized message destined for one `message` row. */
export type ParsedMessage = {
  /** Dedup key: assistant `message.id` (== requestId); user records use `uuid`. */
  messageId: string | null;
  uuid: string | null;
  parentUuid: string | null;
  role: "user" | "assistant";
  text: string | null;
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
function extractToolResult(
  record: Record<string, unknown>,
  content: unknown,
): ParsedToolResult | null {
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
function extractAgentSpawn(
  record: Record<string, unknown>,
  toolUseId: string,
): ParsedAgentSpawn | null {
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
      typeof tur.totalTokens === "number"
        ? tur.totalTokens
        : usage === undefined
          ? null
          : sumUsageTokens(usage),
  };
}

/** Sum every token bucket of a raw `usage` (the parent-aggregate cross-check). */
function sumUsageTokens(usage: RawUsage): number {
  const s = parseUsage(usage);
  return (
    s.inputTokens +
    s.outputTokens +
    s.cacheCreation5mTokens +
    s.cacheCreation1hTokens +
    s.cacheReadTokens
  );
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
 * deduplicated by `message.id` (finding #4) — the FIRST record for a given id
 * wins (it carries the usage, repeated identically across content-block records).
 */
export function parseSessionLines(lines: Iterable<string>): ParsedSession {
  const messages: ParsedMessage[] = [];
  const toolResults = new Map<string, ParsedToolResult>();
  const prLinks: ParsedPrLink[] = [];
  const turnDurations: ParsedTurnDuration[] = [];
  const agentSpawns = new Map<string, ParsedAgentSpawn>();
  const seenAssistantIds = new Set<string>();
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

    if (type !== "assistant" && type !== "user") {
      continue; // attachment/mode/etc. skipped gracefully (log-format §6).
    }

    // Per-record context fields (finding #10) — take the first non-null seen.
    cwd ??= asString(record.cwd);
    gitBranch ??= asString(record.gitBranch);
    ccVersion ??= asString(record.version);

    const message = (record.message ?? {}) as Record<string, unknown>;
    const text = extractText(message.content);

    if (type === "user") {
      const toolResult = extractToolResult(record, message.content);
      if (toolResult !== null) {
        toolResults.set(toolResult.toolUseId, toolResult);
        const spawn = extractAgentSpawn(record, toolResult.toolUseId);
        if (spawn !== null) agentSpawns.set(spawn.agentId, spawn);
      } else {
        // A genuine user prompt (no tool_result) seeds the title fallback.
        firstUserText ??= text;
      }
      messages.push({
        messageId: null,
        uuid: asString(record.uuid),
        parentUuid: asString(record.parentUuid),
        role: "user",
        text,
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
        timestamp: toEpochMs(record.timestamp),
      });
      continue;
    }

    // assistant — dedup by message.id (finding #4).
    const messageId = asString(message.id) ?? asString(record.requestId);
    if (messageId !== null) {
      if (seenAssistantIds.has(messageId)) continue;
      seenAssistantIds.add(messageId);
    }

    const usage = parseUsage(message.usage as RawUsage | undefined);
    messages.push({
      messageId,
      uuid: asString(record.uuid),
      parentUuid: asString(record.parentUuid),
      role: "assistant",
      text,
      toolUses: extractToolUseBlocks(message.content),
      ...usage,
      model: asString(message.model),
      attributionSkill: asString(record.attributionSkill),
      attributionAgent: asString(record.attributionAgent),
      attributionPlugin: asString(record.attributionPlugin),
      attributionMcpServer: asString(record.attributionMcpServer),
      permissionMode: asString(record.permissionMode),
      isApiError: record.isApiErrorMessage === true,
      apiErrorMessage: asString(record.apiErrorStatus),
      timestamp: toEpochMs(record.timestamp),
    });
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

/** Dominant model = the model with the most OUTPUT tokens across assistant turns. */
export function pickDominantModel(messages: ParsedMessage[]): string | null {
  const outputByModel = new Map<string, number>();
  for (const m of messages) {
    if (m.model === null) continue;
    outputByModel.set(
      m.model,
      (outputByModel.get(m.model) ?? 0) + (m.outputTokens ?? 0),
    );
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
