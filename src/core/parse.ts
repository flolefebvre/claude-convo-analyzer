export type ParsedToolUse = {
  toolUseId: string | null;
  name: string;
  inputJson: string;
};

export type ParsedToolResult = {
  toolUseId: string;
  resultText: string | null;
  isError: boolean;
};

export type ParsedPrLink = {
  prNumber: number | null;
  prUrl: string;
  prRepository: string | null;
};

export type ParsedTurnDuration = {
  durationMs: number;
  messageCount: number;
};

export type ParsedAgentSpawn = {
  agentId: string;
  toolUseId: string | null;
  agentType: string | null;
  resolvedModel: string | null;
  totalTokens: number | null;
};

export type MessageKind = "prompt" | "tool-result" | "meta";

export type ParsedMessage = {
  messageId: string | null;
  uuid: string | null;
  parentUuid: string | null;
  role: "user" | "assistant";
  kind: MessageKind | null;
  text: string | null;
  toolUses: ParsedToolUse[];
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
  apiErrorMessage: string | null;
  effort: string | null;
  timestamp: number | null;
};

export type ParsedSession = {
  cwd: string | null;
  gitBranch: string | null;
  ccVersion: string | null;
  title: string | null;
  dominantModel: string | null;
  messages: ParsedMessage[];
  toolResults: Map<string, ParsedToolResult>;
  prLinks: ParsedPrLink[];
  turnDurations: ParsedTurnDuration[];
  agentSpawns: Map<string, ParsedAgentSpawn>;
  malformedLines: number;
};

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

function sumUsageTokens(usage: RawUsage): number {
  const s = parseUsage(usage);
  return s.inputTokens + s.outputTokens + s.cacheCreation5mTokens + s.cacheCreation1hTokens + s.cacheReadTokens;
}

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

export function parseSessionLines(lines: Iterable<string>): ParsedSession {
  const messages: ParsedMessage[] = [];
  const toolResults = new Map<string, ParsedToolResult>();
  const prLinks: ParsedPrLink[] = [];
  const turnDurations: ParsedTurnDuration[] = [];
  const agentSpawns = new Map<string, ParsedAgentSpawn>();
  const assistantById = new Map<string, ParsedMessage>();
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
      continue;
    }

    if (type !== "assistant" && type !== "user") {
      continue;
    }

    cwd ??= asString(record.cwd);
    gitBranch ??= asString(record.gitBranch);
    ccVersion ??= asString(record.version);

    const message = (record.message ?? {}) as Record<string, unknown>;
    const text = extractText(message.content);

    if (type === "user") {
      const toolResult = extractToolResult(record, message.content);
      let kind: MessageKind;
      if (toolResult !== null) {
        kind = "tool-result";
        toolResults.set(toolResult.toolUseId, toolResult);
        const spawn = extractAgentSpawn(record, toolResult.toolUseId);
        if (spawn !== null) agentSpawns.set(spawn.agentId, spawn);
      } else if (record.isMeta === true) {
        kind = "meta";
      } else {
        kind = "prompt";
        firstUserText ??= text;
      }
      messages.push({
        messageId: null,
        uuid: asString(record.uuid),
        parentUuid: asString(record.parentUuid),
        role: "user",
        kind,
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
        effort: null,
        timestamp: toEpochMs(record.timestamp),
      });
      continue;
    }

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
      effort: asString(record.effort),
      timestamp: toEpochMs(record.timestamp),
    };
    messages.push(parsed);
    if (messageId !== null) assistantById.set(messageId, parsed);
  }

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

export function pickDominantModel(messages: ParsedMessage[]): string | null {
  const outputByModel = new Map<string, number>();
  for (const m of messages) {
    if (m.model === null) continue;
    outputByModel.set(m.model, (outputByModel.get(m.model) ?? 0) + (m.outputTokens ?? 0));
  }
  let best: string | null = null;
  let bestOutput = -1;
  for (const [model, output] of outputByModel) {
    if (output > bestOutput) {
      best = model;
      bestOutput = output;
    }
  }
  return best;
}
