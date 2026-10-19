// What was sent (GLOSSARY.md): what a recorded Turn's API request actually
// sent the model, read on demand when the reader opens it. The database
// locates the API request and the previous one of the same Agent; the
// Recording file provides their bodies, the only two restored (ADR-0006: no
// body is ever written to the database). Framework-free (ADR-0002).

import { readClient } from "@/core/db";
import {
  canonicalJson,
  defaultRecordingsRoot,
  readSelectedApiRequests,
  type RecordedApiRequest,
  type RecordedHeaders,
  recordingFilePath,
} from "@/core/recording";

/** One content block as sent: text shown as text, any other block as pretty-printed JSON. */
export type SentBlock = { kind: "text"; text: string } | { kind: "json"; json: string };

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

/** How long the API request took, in ms from its arrival at the Recorder. */
export type SentTimings = {
  /** Null when no response byte ever came back. */
  timeToFirstByteMs: number | null;
  durationMs: number;
};

/** Everything the "What was sent" panel of one Turn shows. Plain and serializable. */
export type WhatWasSent = {
  parameters: SentParameters;
  timings: SentTimings;
  /**
   * Row id of the previous API request of the same Agent; null when none was
   * recorded (the Agent's first Turn, or the first recorded one), and then
   * every message is new.
   */
  previousApiRequestId: number | null;
  /** The messages the previous API request did not send, in order (cache breakpoints ignored). */
  newMessages: SentMessage[];
  /** The whole request: every system block with its cache breakpoints, every tool definition, every other parameter. */
  fullRequest: {
    systemBlocks: SentSystemBlock[];
    tools: SentTool[];
    /** Every body field but `system`, `tools` and `messages`, pretty-printed. */
    parametersJson: string;
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
type RequestBody = Record<string, unknown>;

/**
 * What the API request of `api_request` row `apiRequestId` sent, against the
 * previous API request of the same Agent: the latest of its Conversation and
 * Agent to arrive earlier that is a Turn other than this one (so Side requests
 * and failed attempts of the same Turn are skipped). Null for an unknown row,
 * or when the Recording no longer holds the API request.
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
              AND: [{ messageId: { not: null } }, { messageId: { not: row.messageId } }],
            },
            orderBy: [{ arrivedAt: "desc" }, { id: "desc" }],
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
    const parameters = Object.fromEntries(Object.entries(body).filter(([field]) => !PIECE_FIELDS.has(field)));
    return {
      parameters: sentParameters(body, apiRequest.headers),
      timings: {
        timeToFirstByteMs: row.firstByteAt === null ? null : Number(row.firstByteAt - row.arrivedAt),
        durationMs: Number(row.endedAt - row.arrivedAt),
      },
      previousApiRequestId: previousBody === null ? null : previousRow!.id,
      newMessages: messagesNewSince(messagesOf(body), previousBody === null ? [] : messagesOf(previousBody)),
      fullRequest: {
        systemBlocks: systemBlocksOf(body).map(sentSystemBlock),
        tools: toolsOf(body).map(sentTool),
        parametersJson: JSON.stringify(parameters, null, 2),
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

/** The messages of `messages` that `previousMessages` did not hold, compared without their cache breakpoints. */
function messagesNewSince(messages: unknown[], previousMessages: unknown[]): SentMessage[] {
  const previousMessageJsons = new Set(previousMessages.map((message) => canonicalJson(withoutCacheControl(message))));
  return messages
    .filter((message) => !previousMessageJsons.has(canonicalJson(withoutCacheControl(message))))
    .map(sentMessage);
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

/** A string, or a `text` block, as its text; anything else as pretty-printed JSON. */
function sentBlock(block: unknown): SentBlock {
  if (typeof block === "string") return { kind: "text", text: block };
  if (isPlainObject(block) && block.type === "text" && typeof block.text === "string") {
    return { kind: "text", text: block.text };
  }
  return { kind: "json", json: JSON.stringify(block, null, 2) };
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
