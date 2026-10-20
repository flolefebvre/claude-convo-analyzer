// What was sent (GLOSSARY.md): what a recorded Turn's API request actually
// sent the model, read on demand when the reader opens it. The database
// locates the API request and the previous one of the same Agent; the
// Recording file provides their bodies, the only two restored (ADR-0006: no
// body is ever written to the database). Framework-free (ADR-0002).

import { structuredPatch } from "diff";

import { isSideRequestKind } from "@/core/api-request-kind";
import { readClient } from "@/core/db";
import {
  canonicalJson,
  defaultRecordingsRoot,
  readSelectedApiRequests,
  type RecordedApiRequest,
  type RecordedHeaders,
  recordingFilePath,
} from "@/core/recording";

/** A value as parsed from JSON: what a body, or any part of one, is. */
export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

/**
 * What a sent block is: `text`, `tool_use`, `tool_result`, `image`, a
 * `system-reminder` (a text block opening with its tag), else the block's
 * own `type` (`thinking`, `document`, …), or `unknown` without one.
 */
export type SentBlockKind = string;

/** One content block as sent, with its kind: a text block shown as text, any other as pretty-printed JSON. */
export type SentBlock = { kind: SentBlockKind } & (
  { shownAs: "text"; text: string } | { shownAs: "json"; json: string }
);

/** One message of an API request: its role, then each content block (a string content is one text block). */
export type SentMessage = { role: string; blocks: SentBlock[] };

/** One system block as sent, with the cache breakpoint it carries (`cache_control.type`, plus its `ttl`), if any. */
export type SentSystemBlock = SentBlock & { cacheControl: string | null };

/** One tool definition as sent, pretty-printed. */
export type SentTool = { name: string; definitionJson: string };

/** The request parameters a reader looks at first. */
export type SentParameters = {
  model: string | null;
  maxTokens: number | null;
  /** The `thinking` parameter as text (`enabled · budget_tokens 31999`), whatever its shape; null when absent. */
  thinking: string | null;
  /** `output_config.effort`; null when absent. */
  effort: string | null;
  /** The beta features: the `anthropic-beta` header's, then the body's `betas`, deduplicated. */
  betas: string[];
};

/** One line of a line diff: added, removed, or unchanged context around a change. */
export type DiffLine = { change: "added" | "removed" | "unchanged"; text: string };

/** A run of changed lines, with up to {@link DIFF_CONTEXT_LINE_COUNT} unchanged lines around it. */
export type DiffHunk = { lines: DiffLine[] };

/** A system-prompt diff line; a changed one is volatile when it matches {@link VOLATILE_SYSTEM_LINE_PATTERNS}. */
export type SystemPromptDiffLine = DiffLine & { isVolatile: boolean };

/** The line diff of the system text (its blocks joined by newlines) against the previous API request's. */
export type SystemPromptDiff = {
  hunks: { lines: SystemPromptDiffLine[] }[];
  /** True when every changed line is volatile (dates, git status, the working directory). */
  isVolatileOnly: boolean;
};

/** A tool definition whose description or input schema changed, as a line diff of its pretty-printed definition. */
export type ChangedTool = {
  name: string;
  changedFields: ("description" | "input_schema")[];
  hunks: DiffHunk[];
};

/** The tool definitions added, removed and changed since the previous API request, keyed by name. */
export type ToolsDiff = { added: SentTool[]; removed: SentTool[]; changed: ChangedTool[] };

/** How many unchanged lines a diff hunk keeps around its changed lines. */
const DIFF_CONTEXT_LINE_COUNT = 2;

/**
 * The system-prompt lines that change between Turns without anything real
 * changing: today's date, the working directory, the git status section
 * (status, branch, its file entries and recent commits), and blank lines.
 */
export const VOLATILE_SYSTEM_LINE_PATTERNS: readonly RegExp[] = [
  /^\s*(?:Today's date|Current date)\b/i,
  /^\s*(?:Primary )?working directory:/i,
  /^\s*(?:gitStatus|Git status):/i,
  /^\s*Current branch:/i,
  /^\s*Status:/i,
  /^\s*Recent commits:/i,
  // The git status of a clean tree, alone under `Status:`.
  /^\s*\(clean\)\s*$/,
  // A git status entry: its status code, then one path-like token and nothing after it.
  /^\s*[MADRCU?!]{1,2}\s+\S*[/.]\S*$/,
  // A recent commit: its abbreviated hash, then its subject.
  /^[0-9a-f]{7,40}\s/,
  /^\s*$/,
];

/** How long the API request took, in ms from its arrival at the Recorder. */
export type SentTimings = {
  /** Null when no response byte ever came back. */
  timeToFirstByteMs: number | null;
  durationMs: number;
};

/** One failed attempt of the Turn (GLOSSARY.md, Failed attempt): how the API answered it, and the time it lost. */
export type FailedAttempt = {
  /** The response's HTTP status. */
  status: number;
  /** The response body's `error.message`, else the proxy error; null when neither said why. */
  errorMessage: string | null;
  /** From its arrival at the Recorder to its failure. */
  lostMs: number;
  /** When it reached the Recorder (ISO 8601). */
  arrivedAt: string;
};

/** Everything the "What was sent" panel of one Turn or Side request shows. Plain and serializable. */
export type WhatWasSent = {
  /** True when the API request is a Side request (GLOSSARY.md), which belongs to no Agent. */
  isSideRequest: boolean;
  parameters: SentParameters;
  timings: SentTimings;
  /** The failed attempts that preceded this API request, oldest first; empty when it succeeded at the first try. */
  failedAttempts: FailedAttempt[];
  /**
   * Row id of the previous API request of the same Agent; null when none was
   * recorded (the Agent's first Turn, or the first recorded one) or on a Side
   * request, which has no Agent, and then every message is new.
   */
  previousApiRequestId: number | null;
  /**
   * Index in `fullRequest.messages` of the first message the previous API
   * request did not send — the messages before it are those the two share, in
   * order (cache breakpoints ignored); 0 without a previous one.
   */
  firstNewMessageIndex: number;
  /** How the system prompt changed since the previous API request; null when it did not, or without one. */
  systemPromptDiff: SystemPromptDiff | null;
  /** How the tool definitions changed since the previous API request; null when none did, or without one. */
  toolsDiff: ToolsDiff | null;
  /** The whole request: every system block with its cache breakpoints, every tool definition and message, every other body field. */
  fullRequest: {
    systemBlocks: SentSystemBlock[];
    tools: SentTool[];
    messages: SentMessage[];
    /** Every body field but `system`, `tools` and `messages`, as sent. */
    parameterByName: Record<string, JsonValue>;
  };
};

type WhatWasSentOptions = {
  dbPath?: string;
  /** Where the Recordings are read from; `defaultRecordingsRoot()` when absent. */
  recordingsRoot?: string;
};

/** What the `api_request` row holds that finds its API request in the Recording file. */
type ApiRequestKey = {
  requestId: string | null;
  arrivedAt: bigint;
  method: string;
  path: string;
  externalAgentId: string | null;
};

/** The body fields a Recording stores as pieces; every other field is a parameter. */
const PIECE_FIELDS = new Set(["system", "tools", "messages"]);

/** A request body that is a JSON object: what a Messages request is. */
type RequestBody = Record<string, JsonValue>;

/**
 * What the API request of `api_request` row `apiRequestId` sent, against the
 * previous API request of the same Agent: the latest of its Conversation and
 * Agent to arrive earlier that is a Turn's request other than this one (so
 * Side requests and failed attempts are skipped), with the failed attempts
 * that preceded it. A Side request has no Agent, so no previous API request:
 * everything it sent is new. Null for an unknown row, or when the Recording no
 * longer holds the API request.
 *
 * @example
 * const whatWasSent = await getWhatWasSent(message.apiRequestId);
 */
export async function getWhatWasSent(apiRequestId: number, opts: WhatWasSentOptions = {}): Promise<WhatWasSent | null> {
  const { prisma, owned } = readClient(opts.dbPath);
  try {
    const row = await prisma.apiRequest.findUnique({
      where: { id: apiRequestId },
      include: { conversation: { select: { sessionId: true } } },
    });
    if (row === null) return null;
    const previousRow =
      row.agentId === null
        ? null
        : await prisma.apiRequest.findFirst({
            where: {
              conversationId: row.conversationId,
              agentId: row.agentId,
              arrivedAt: { lt: row.arrivedAt },
              kind: "turn",
              messageId: { not: row.messageId },
            },
            orderBy: [{ arrivedAt: "desc" }, { id: "desc" }],
          });
    const failedAttemptRows =
      row.kind !== "turn"
        ? []
        : await prisma.apiRequest.findMany({
            where: { messageId: row.messageId, kind: "failed-attempt" },
            orderBy: [{ arrivedAt: "asc" }, { id: "asc" }],
            select: { status: true, errorMessage: true, arrivedAt: true, endedAt: true },
          });

    const filePath = recordingFilePath(opts.recordingsRoot ?? defaultRecordingsRoot(), row.conversation.sessionId);
    if (filePath === null) return null;
    const keys = previousRow === null ? [row] : [row, previousRow];
    const apiRequests = readApiRequestsUnlessVanished(filePath, keys);
    const apiRequest = apiRequestOf(apiRequests, row);
    if (apiRequest === null || !isRequestBody(apiRequest.body)) return null;
    const previousApiRequest = previousRow === null ? null : apiRequestOf(apiRequests, previousRow);
    const previousBody =
      previousApiRequest !== null && isRequestBody(previousApiRequest.body) ? previousApiRequest.body : null;

    const body = apiRequest.body;
    const messages = messagesOf(body);
    return {
      isSideRequest: isSideRequestKind(row.kind),
      parameters: sentParameters(body, apiRequest.headers),
      timings: {
        timeToFirstByteMs: row.firstByteAt === null ? null : Number(row.firstByteAt - row.arrivedAt),
        durationMs: Number(row.endedAt - row.arrivedAt),
      },
      failedAttempts: failedAttemptRows.map((attempt) => ({
        status: attempt.status,
        errorMessage: attempt.errorMessage,
        lostMs: Number(attempt.endedAt - attempt.arrivedAt),
        arrivedAt: new Date(Number(attempt.arrivedAt)).toISOString(),
      })),
      previousApiRequestId: previousBody === null ? null : previousRow!.id,
      firstNewMessageIndex: sharedPrefixLength(messages, previousBody === null ? [] : messagesOf(previousBody)),
      systemPromptDiff: previousBody === null ? null : systemPromptDiff(previousBody, body),
      toolsDiff: previousBody === null ? null : toolsDiff(toolsOf(previousBody), toolsOf(body)),
      fullRequest: {
        systemBlocks: systemBlocksOf(body).map(sentSystemBlock),
        tools: toolsOf(body).map(sentTool),
        messages: messages.map(sentMessage),
        parameterByName: Object.fromEntries(Object.entries(body).filter(([field]) => !PIECE_FIELDS.has(field))),
      },
    };
  } finally {
    // Only a caller-owned (non-default) client is disconnected; the shared
    // default singleton stays open for the next request.
    if (owned) await prisma.$disconnect();
  }
}

/** The API requests of the file at `filePath` that match one of `keys`, in full; none when the file is gone. */
function readApiRequestsUnlessVanished(filePath: string, keys: ApiRequestKey[]): RecordedApiRequest[] {
  try {
    return readSelectedApiRequests(filePath, (apiRequest) => keys.some((key) => isApiRequestOfKey(apiRequest, key)));
  } catch (error) {
    if (error instanceof Error && (error.cause as NodeJS.ErrnoException)?.code === "ENOENT") return [];
    throw error;
  }
}

/**
 * The API request of `key` among `apiRequests`: by `requestId` when the row
 * has one — the arrival time telling apart two requests sharing it — else by
 * arrival time, method, path and agent.
 */
function apiRequestOf(apiRequests: RecordedApiRequest[], key: ApiRequestKey): RecordedApiRequest | null {
  const matches = apiRequests.filter((apiRequest) => isApiRequestOfKey(apiRequest, key));
  if (matches.length <= 1) return matches[0] ?? null;
  return matches.find((apiRequest) => Date.parse(apiRequest.timings.arrivedAt) === Number(key.arrivedAt)) ?? null;
}

function isApiRequestOfKey(
  apiRequest: Pick<RecordedApiRequest, "response" | "timings" | "method" | "path" | "agentId">,
  key: ApiRequestKey,
): boolean {
  if (key.requestId !== null) return apiRequest.response.requestId === key.requestId;
  return (
    Date.parse(apiRequest.timings.arrivedAt) === Number(key.arrivedAt) &&
    apiRequest.method === key.method &&
    apiRequest.path === key.path &&
    apiRequest.agentId === key.externalAgentId
  );
}

function sentParameters(body: RequestBody, headers: RecordedHeaders): SentParameters {
  const outputConfig = body.output_config;
  const effort = isPlainObject(outputConfig) && typeof outputConfig.effort === "string" ? outputConfig.effort : null;
  const headerBetas = [headers["anthropic-beta"] ?? []].flat().flatMap((value) => value.split(","));
  const bodyBetas = Array.isArray(body.betas) ? body.betas.filter((beta) => typeof beta === "string") : [];
  const betas = [...new Set([...headerBetas, ...bodyBetas].map((beta) => beta.trim()).filter(Boolean))];
  return {
    model: typeof body.model === "string" ? body.model : null,
    maxTokens: typeof body.max_tokens === "number" ? body.max_tokens : null,
    thinking: body.thinking === undefined ? null : thinkingText(body.thinking),
    effort,
    betas,
  };
}

/** A `thinking` parameter as text: its `type`, then each other field as `name value`; any other shape as JSON. */
function thinkingText(thinking: unknown): string {
  if (!isPlainObject(thinking) || typeof thinking.type !== "string") return JSON.stringify(thinking);
  const { type, ...fields } = thinking;
  return [
    type,
    ...Object.entries(fields).map(
      ([name, value]) => `${name} ${typeof value === "string" ? value : JSON.stringify(value)}`,
    ),
  ].join(" · ");
}

/**
 * The length of the longest prefix `messages` shares with `previousMessages`,
 * compared position by position without their cache breakpoints — so a new
 * prompt that repeats an earlier one is still new.
 */
function sharedPrefixLength(messages: unknown[], previousMessages: unknown[]): number {
  const comparableJson = (message: unknown) => canonicalJson(withoutCacheControl(message));
  let length = 0;
  while (
    length < Math.min(messages.length, previousMessages.length) &&
    comparableJson(messages[length]) === comparableJson(previousMessages[length])
  ) {
    length += 1;
  }
  return length;
}

/** The system-prompt diff from `previousBody` to `body`; null when the system text is the same. */
function systemPromptDiff(previousBody: RequestBody, body: RequestBody): SystemPromptDiff | null {
  const hunks = lineDiffHunks(systemTextOf(previousBody), systemTextOf(body)).map((hunk) => ({
    lines: hunk.lines.map((line) => ({
      ...line,
      isVolatile:
        line.change !== "unchanged" && VOLATILE_SYSTEM_LINE_PATTERNS.some((pattern) => pattern.test(line.text)),
    })),
  }));
  if (hunks.length === 0) return null;
  const changedLines = hunks.flatMap((hunk) => hunk.lines).filter((line) => line.change !== "unchanged");
  return { hunks, isVolatileOnly: changedLines.every((line) => line.isVolatile) };
}

/** The system text of `body`: each block's text (any other block as JSON), joined by newlines. */
function systemTextOf(body: RequestBody): string {
  return systemBlocksOf(body)
    .map((block) => {
      const sent = sentBlock(block);
      return sent.shownAs === "text" ? sent.text : sent.json;
    })
    .join("\n");
}

/** The tools diff from `previousTools` to `tools`, by name; null when none was added, removed or changed. */
function toolsDiff(previousTools: unknown[], tools: unknown[]): ToolsDiff | null {
  const previousToolByName = new Map(previousTools.map((tool) => [sentTool(tool).name, tool]));
  const toolNames = new Set(tools.map((tool) => sentTool(tool).name));
  const added: SentTool[] = [];
  const changed: ChangedTool[] = [];
  for (const tool of tools) {
    const sent = sentTool(tool);
    const previousTool = previousToolByName.get(sent.name);
    if (previousTool === undefined) {
      added.push(sent);
      continue;
    }
    const changedFields = (["description", "input_schema"] as const).filter(
      (field) => canonicalJson(fieldOf(previousTool, field)) !== canonicalJson(fieldOf(tool, field)),
    );
    if (changedFields.length > 0) {
      changed.push({
        name: sent.name,
        changedFields,
        hunks: lineDiffHunks(sentTool(previousTool).definitionJson, sent.definitionJson),
      });
    }
  }
  const removed = previousTools.map(sentTool).filter((tool) => !toolNames.has(tool.name));
  if (added.length + removed.length + changed.length === 0) return null;
  return { added, removed, changed };
}

function fieldOf(tool: unknown, field: string): unknown {
  return isPlainObject(tool) ? tool[field] : undefined;
}

/** The hunks of the line diff from `previousText` to `text`; empty when they are the same. */
function lineDiffHunks(previousText: string, text: string): DiffHunk[] {
  // A final newline on both sides keeps jsdiff from flagging a missing one.
  const patch = structuredPatch("", "", `${previousText}\n`, `${text}\n`, undefined, undefined, {
    context: DIFF_CONTEXT_LINE_COUNT,
  });
  return patch.hunks.map((hunk) => ({
    lines: hunk.lines.flatMap((line): DiffLine[] => {
      const marker = line[0];
      if (marker === "+") return [{ change: "added", text: line.slice(1) }];
      if (marker === "-") return [{ change: "removed", text: line.slice(1) }];
      if (marker === " ") return [{ change: "unchanged", text: line.slice(1) }];
      return []; // "\ No newline at end of file"
    }),
  }));
}

/** `value` with every `cache_control` key removed, at any depth. */
function withoutCacheControl(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(withoutCacheControl);
  if (!isPlainObject(value)) return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => key !== "cache_control")
      .map(([key, nested]) => [key, withoutCacheControl(nested)]),
  );
}

function sentMessage(message: unknown): SentMessage {
  if (!isPlainObject(message)) return { role: "unknown", blocks: [sentBlock(message)] };
  const content = message.content;
  return {
    role: typeof message.role === "string" ? message.role : "unknown",
    blocks: Array.isArray(content) ? content.map(sentBlock) : [sentBlock(content)],
  };
}

/** The tag opening a system-reminder: context Claude Code injects into a text block. */
const SYSTEM_REMINDER_TAG = "<system-reminder>";

/** A string, or a `text` block, as its text; anything else as pretty-printed JSON. */
function sentBlock(block: unknown): SentBlock {
  const text =
    typeof block === "string"
      ? block
      : isPlainObject(block) && block.type === "text" && typeof block.text === "string"
        ? block.text
        : null;
  if (text !== null) {
    return {
      kind: text.trimStart().startsWith(SYSTEM_REMINDER_TAG) ? "system-reminder" : "text",
      shownAs: "text",
      text,
    };
  }
  const kind = isPlainObject(block) && typeof block.type === "string" ? block.type : "unknown";
  return { kind, shownAs: "json", json: JSON.stringify(block, null, 2) };
}

function sentSystemBlock(block: unknown): SentSystemBlock {
  const cacheControl = isPlainObject(block) && isPlainObject(block.cache_control) ? block.cache_control : null;
  return {
    ...sentBlock(block),
    cacheControl:
      cacheControl === null
        ? null
        : [cacheControl.type, cacheControl.ttl].filter((part) => typeof part === "string").join(" ") || "set",
  };
}

function sentTool(tool: unknown): SentTool {
  return {
    name: isPlainObject(tool) && typeof tool.name === "string" ? tool.name : "unnamed",
    definitionJson: JSON.stringify(tool, null, 2),
  };
}

function messagesOf(body: RequestBody): unknown[] {
  return Array.isArray(body.messages) ? body.messages : [];
}

/** The system blocks of `body`: a string system prompt is one block. */
function systemBlocksOf(body: RequestBody): unknown[] {
  if (Array.isArray(body.system)) return body.system;
  return body.system === undefined ? [] : [body.system];
}

function toolsOf(body: RequestBody): unknown[] {
  return Array.isArray(body.tools) ? body.tools : [];
}

function isRequestBody(body: unknown): body is RequestBody {
  return isPlainObject(body);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
