// JSONL session parser (findings #2,#3,#4,#7,#8,#10). Reads one session file's
// lines into a typed, deduplicated `ParsedSession` ready for DB write.
//
// SLICE SCOPE: handles `assistant`, `user`, `ai-title`, `custom-title`; all other
// record types are skipped gracefully (Slice 4/5 add system/turn_duration,
// pr-link, tool results, sub-agent transcripts). A line that fails JSON.parse is
// skipped and counted (never fatal).
//
// EXTENSION POINTS for later slices:
//   - `parseSessionLines` is the single dispatch site over record `type`; add new
//     branches there. The same routine parses a sub-agent transcript (it is the
//     same per-turn shape — CONTEXT.md), so Slice 4 reuses it directly.
//   - `extractText` / `extractToolUseBlocks` decode the `content` union once.
//   - `ParsedMessage` already carries `uuid`/`parentUuid` so Slice 4 can build the
//     message-uuid index for continued-from resolution.

/** A normalized message destined for one `message` row. */
export type ParsedMessage = {
  /** Dedup key: assistant `message.id` (== requestId); user records use `uuid`. */
  messageId: string | null;
  uuid: string | null;
  parentUuid: string | null;
  role: "user" | "assistant";
  text: string | null;
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
  malformedLines: number;
};

/** A `content` block in an assistant/user message. */
type ContentBlock =
  | { type: "text"; text?: string }
  | { type: "thinking"; thinking?: string; signature?: string }
  | { type: "tool_use"; id?: string; name?: string; input?: unknown }
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

    if (type !== "assistant" && type !== "user") {
      continue; // Slice 4/5 handle system/pr-link/etc.; skip gracefully here.
    }

    // Per-record context fields (finding #10) — take the first non-null seen.
    cwd ??= asString(record.cwd);
    gitBranch ??= asString(record.gitBranch);
    ccVersion ??= asString(record.version);

    const message = (record.message ?? {}) as Record<string, unknown>;
    const text = extractText(message.content);

    if (type === "user") {
      firstUserText ??= text;
      messages.push({
        messageId: null,
        uuid: asString(record.uuid),
        parentUuid: asString(record.parentUuid),
        role: "user",
        text,
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
