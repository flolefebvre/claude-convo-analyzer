// What was sent (GLOSSARY.md): what a Turn's API request actually sent the
// model, read on demand when the reader opens it, from the logs (Claude Code
// 2.1.300+, ADR-0007). The database holds it all: the `api_request`
// rows of the Agent, whose base chain gives the request's message hashes, and
// its system prompt, tool set and messages, each stored under its hash. The
// raw JSON reads one API request the same way. Framework-free (ADR-0002).

import { structuredPatch } from "diff";

import { canonicalJson } from "@/core/canonical-json";
import { readClient } from "@/core/db";
import type { AttachmentType, InjectedContextPiece } from "@/core/injected-context";
import { orderedBefore, REVERSE_TRANSCRIPT_ORDER, TRANSCRIPT_ORDER } from "@/core/transcript-order";

/** A value as parsed from JSON: what a body, or any part of one, is. */
export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

/**
 * What a sent block is: `text`, `tool_use`, `tool_result`, `image`,
 * `injected-context` (a text block opening with a system-reminder tag, any
 * text of a system message, or a piece of Injected context), else the block's
 * own `type` (`thinking`, `document`, …), or `unknown` without one.
 */
export type SentBlockKind = string;

/** One content block as sent, with its kind: a text block shown as text, any other as pretty-printed JSON. */
export type SentBlock = { kind: SentBlockKind } & (
  { shownAs: "text"; text: string } | { shownAs: "json"; json: string }
);

/**
 * What a reader sees as one unit of a sent message: a content block, or one
 * piece of Injected context from a block that fuses several — its text
 * exactly as sent — with what it is and its first line.
 */
export type SentMessagePart = SentBlock & {
  /**
   * What the part is: a piece of Injected context by its kind ("CLAUDE.md ·
   * AGENTS.md", "Skill list", "Date", …; see {@link injectedContextLabel}),
   * "Injected context" when no attachment names it (a system-reminder, a system
   * message's text), "Prompt" (a user's text), "Assistant text", "Thinking",
   * "Image", "Tool call · <name>", "Tool result · <name>" (the call an earlier
   * message of the request made; "Tool result" without one), else its kind.
   */
  label: string;
  /**
   * Its first non-blank line — a text's (system-reminder tags left out), a tool
   * result's text, a tool call's input as compact JSON — cut at
   * {@link SENT_PART_PREVIEW_MAX_CHARS} characters, then "…"; empty for any other part.
   */
  preview: string;
};

/**
 * One message of an API request: its role, then its parts in order — each
 * content block (a string content is one text block, a missing one none), a
 * block fusing several pieces of Injected context split into one part each.
 */
export type SentMessage = { role: string; parts: SentMessagePart[] };

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
  /** The beta features: the body's `betas`, deduplicated. */
  betas: string[];
  /** How many cache breakpoints the request set, on its system prompt, tools and messages. */
  cacheBreakpointCount: number;
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
  /** What the volatile changed lines belong to, each once, in the order the diff meets them; empty without any. */
  volatileChangeNames: VolatileChangeName[];
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

/** What a volatile system-prompt line belongs to: the thing that moved when it changed. */
export type VolatileChangeName = "date" | "working directory" | "git status" | "blank lines";

/**
 * The system-prompt lines that change between Turns without anything real
 * changing, each with what it belongs to: today's date, the working
 * directory, the git status section (status, branch, its file entries and
 * recent commits), and blank lines. A line belongs to the first it matches.
 */
export const VOLATILE_SYSTEM_LINE_PATTERNS: readonly { name: VolatileChangeName; pattern: RegExp }[] = [
  { name: "date", pattern: /^\s*(?:Today's date|Current date)\b/i },
  { name: "working directory", pattern: /^\s*(?:Primary )?working directory:/i },
  { name: "git status", pattern: /^\s*(?:gitStatus|Git status):/i },
  { name: "git status", pattern: /^\s*Current branch:/i },
  { name: "git status", pattern: /^\s*Status:/i },
  { name: "git status", pattern: /^\s*Recent commits:/i },
  // The git status of a clean tree, alone under `Status:`.
  { name: "git status", pattern: /^\s*\(clean\)\s*$/ },
  // A git status entry: its status code, then one path-like token and nothing after it.
  { name: "git status", pattern: /^\s*[MADRCU?!]{1,2}\s+\S*[/.]\S*$/ },
  // A recent commit: its abbreviated hash, then its subject.
  { name: "git status", pattern: /^[0-9a-f]{7,40}\s/ },
  { name: "blank lines", pattern: /^\s*$/ },
];

/**
 * One Failed attempt of the Turn (GLOSSARY.md, Failed attempt): when it was
 * sent and the time it lost. The logs record neither its status nor its error.
 */
export type FailedAttempt = {
  /**
   * From its sending to the next request's (the failure plus the backoff);
   * null when the logs miss either time.
   */
  lostMs: number | null;
  /** When it was sent (ISO 8601); null when the logs miss it. */
  sentAt: string | null;
};

/** Everything the "What was sent" panel of one Turn shows. Plain and serializable. */
export type WhatWasSent = {
  parameters: SentParameters;
  /** When the API request was sent (ISO 8601); null when the logs miss it. */
  sentAt: string | null;
  /**
   * The Failed attempts that preceded this API request, oldest first; empty
   * when it succeeded at the first try.
   */
  failedAttempts: FailedAttempt[];
  /**
   * Row id of the previous API request of the same Agent; null when there is
   * none (the Agent's first Turn), and then every message is new.
   */
  previousApiRequestId: number | null;
  /**
   * Index in `fullRequest.messages` of the first message the previous API
   * request did not send — the messages before it are those the two share, in
   * order, by hash; 0 without a previous one.
   */
  firstNewMessageIndex: number;
  /** How many of `fullRequest.messages` the logs could not rebuild (its null entries). */
  missingMessageCount: number;
  /** How the system prompt changed since the previous API request; null when it did not, or without one. */
  systemPromptDiff: SystemPromptDiff | null;
  /** How the tool definitions changed since the previous API request; null when none did, or without one. */
  toolsDiff: ToolsDiff | null;
  /** The whole request but its parameters: every system block with its cache breakpoints, every tool definition and message. */
  fullRequest: {
    systemBlocks: SentSystemBlock[];
    tools: SentTool[];
    /** Every message, in order: null for one the logs could not rebuild, kept at its place. */
    messages: (SentMessage | null)[];
  };
};

/** An API request raw (GLOSSARY.md, What was sent), as JSON: what the panel's Raw JSON toggle shows. Plain and serializable. */
export type RawApiRequest = {
  /** The request body as the logs rebuild it, every message they could not rebuild left out. */
  requestBody: JsonValue;
  /** How many messages the logs could not rebuild, left out of `requestBody`. */
  missingMessageCount: number;
};

/** A request body that is a JSON object: what a Messages request is. */
type RequestBody = Record<string, JsonValue>;

/** How the system prompt and the tool definitions changed from `previousBody` to `body`; neither without a previous body. */
function systemPromptAndToolsChanges(
  previousBody: RequestBody | null,
  body: RequestBody,
): Pick<WhatWasSent, "systemPromptDiff" | "toolsDiff"> {
  return {
    systemPromptDiff: previousBody === null ? null : systemPromptDiff(previousBody, body),
    toolsDiff: previousBody === null ? null : toolsDiff(toolsOf(previousBody), toolsOf(body)),
  };
}

/** The system blocks and tools of `body`, with `messages` as its messages. */
function fullRequestOf(body: RequestBody, messages: (SentMessage | null)[]): WhatWasSent["fullRequest"] {
  return {
    systemBlocks: systemBlocksOf(body).map(sentSystemBlock),
    tools: toolsOf(body).map(sentTool),
    messages,
  };
}

/** The client {@link readClient} hands out. */
type ReadPrisma = ReturnType<typeof readClient>["prisma"];

/** What `read` makes of the database at `dbPath`. */
async function withReadClient<Result>(
  dbPath: string | undefined,
  read: (prisma: ReadPrisma) => Promise<Result>,
): Promise<Result> {
  const { prisma, owned } = readClient(dbPath);
  try {
    return await read(prisma);
  } finally {
    // Only a caller-owned (non-default) client is disconnected; the shared
    // default singleton stays open for the next request.
    if (owned) await prisma.$disconnect();
  }
}

/**
 * What the API request of `api_request` row `apiRequestId` sent,
 * from the logs (docs/conversation-log-format.md §9), against the previous
 * API request of the same Agent: the latest earlier one of its file a Turn
 * answered, so an unanswered request, retried since, is skipped; without one,
 * the request in another file of the latest earlier Turn of the Agent that has
 * one, in the transcript order (a resumed session's first own request against
 * its copied history's last). Its messages
 * are rebuilt from the database, a message it could not rebuild kept as null
 * at its place and counted. Null for an unknown row.
 *
 * @example
 * const whatWasSent = await getWhatWasSent(message.apiRequestId!);
 */
export async function getWhatWasSent(
  apiRequestId: number,
  opts: { dbPath?: string } = {},
): Promise<WhatWasSent | null> {
  return withApiRequestRow(apiRequestId, opts.dbPath, async (row, prisma) => {
    const previousRow =
      (await prisma.apiRequest.findFirst({
        where: { agentId: row.agentId, positionInFile: { lt: row.positionInFile }, turns: { some: {} } },
        orderBy: { positionInFile: "desc" },
        include: SYSTEM_PROMPT_AND_TOOL_SET_INCLUDE,
      })) ?? (await apiRequestOfPreviousTurn(prisma, row));
    const messageHashesOf = await messageHashesOfAgentRequests(prisma, row);
    const messageHashes = messageHashesOf(row);
    // A previous request of another file walks its own Agent's base chain.
    const messageHashesOfPrevious =
      previousRow === null || previousRow.agentId === row.agentId
        ? messageHashesOf
        : await messageHashesOfAgentRequests(prisma, previousRow);
    const { body, injectedContextPiecesOfMessages } = await requestOf(prisma, row, messageHashes);
    const messages = sentMessagesOf(body.messages as (JsonValue | null)[], injectedContextPiecesOfMessages);
    const failedAttempts = (await failedAttemptsByApiRequest(prisma, [row])).get(row.id) ?? [];
    return {
      parameters: sentParameters(body, JSON.parse(row.cacheBreakpointsJson) as JsonValue),
      sentAt: row.sentAt === null ? null : new Date(Number(row.sentAt)).toISOString(),
      failedAttempts,
      previousApiRequestId: previousRow?.id ?? null,
      firstNewMessageIndex:
        previousRow === null ? 0 : sharedMessageHashPrefixLength(messageHashes, messageHashesOfPrevious(previousRow)),
      missingMessageCount: messages.filter((message) => message === null).length,
      ...systemPromptAndToolsChanges(previousRow === null ? null : bodyWithoutMessagesOf(previousRow), body),
      fullRequest: fullRequestOf(body, messages),
    };
  });
}

/**
 * The API request of `api_request` row `apiRequestId` raw: its
 * body as the logs rebuild it (docs/conversation-log-format.md §9, step 4) —
 * the parameters, `params.betas` included, then the system prompt, the tools
 * and the messages, each cache breakpoint set at its path — every message it
 * could not rebuild left out and counted. Not exactly as sent: the logs leave
 * out the billing-header system block, `metadata` and `stream`. Null for an
 * unknown row.
 *
 * @example
 * const rawApiRequest = await getRawApiRequest(message.apiRequestId!);
 */
export async function getRawApiRequest(
  apiRequestId: number,
  opts: { dbPath?: string } = {},
): Promise<RawApiRequest | null> {
  return withApiRequestRow(apiRequestId, opts.dbPath, async (row, prisma) => {
    const messageHashes = (await messageHashesOfAgentRequests(prisma, row))(row);
    const { body } = await requestOf(prisma, row, messageHashes);
    const messages = body.messages as (JsonValue | null)[];
    const resolvedMessages = messages.filter((message) => message !== null);
    return {
      requestBody: { ...body, messages: resolvedMessages },
      missingMessageCount: messages.length - resolvedMessages.length,
    };
  });
}

/**
 * Of each Turn among `messageIds` that Failed attempts preceded in the logs,
 * batched: those of its API request, oldest first (log-format §9, Retries) —
 * so a Turn copied into a resumed session's file has its request's too. Each
 * lost the time from its sending to the next request's of its chain, the
 * request itself ending it. A Turn without any is absent.
 *
 * @example
 * const failedAttemptsByMessageId = await failedAttemptsByMessage(prisma, [message.id]);
 */
export async function failedAttemptsByMessage(
  prisma: ReadPrisma,
  messageIds: number[],
): Promise<Map<number, FailedAttempt[]>> {
  const failedAttemptsByMessageId = new Map<number, FailedAttempt[]>();
  if (messageIds.length === 0) return failedAttemptsByMessageId;
  const turnRows = await prisma.message.findMany({
    where: { id: { in: messageIds }, apiRequestId: { not: null } },
    select: { id: true, apiRequest: { select: FAILED_ATTEMPT_CHAIN_SELECT } },
  });
  const failedAttemptsByApiRequestId = await failedAttemptsByApiRequest(
    prisma,
    turnRows.flatMap((turn) => (turn.apiRequest === null ? [] : [turn.apiRequest])),
  );
  for (const turn of turnRows) {
    const failedAttempts = turn.apiRequest === null ? undefined : failedAttemptsByApiRequestId.get(turn.apiRequest.id);
    if (failedAttempts !== undefined) failedAttemptsByMessageId.set(turn.id, failedAttempts);
  }
  return failedAttemptsByMessageId;
}

/** What the chain of Failed attempts ending in an `api_request` row is read with. */
const FAILED_ATTEMPT_CHAIN_SELECT = { id: true, agentId: true, sentAt: true, positionInFile: true } as const;

/** An `api_request` row as {@link FAILED_ATTEMPT_CHAIN_SELECT} reads it. */
type FailedAttemptChainRow = { id: number; agentId: number; sentAt: bigint | null; positionInFile: number };

/**
 * Of each of `requests` that Failed attempts preceded, batched: those
 * attempts, oldest first. They are owned by the request's Turn in its own
 * file (`failed_attempt_of_message_id` never leaves a file), so the attempts
 * owned by a Turn of another Agent are not its.
 */
async function failedAttemptsByApiRequest(
  prisma: ReadPrisma,
  requests: FailedAttemptChainRow[],
): Promise<Map<number, FailedAttempt[]>> {
  const failedAttemptsByApiRequestId = new Map<number, FailedAttempt[]>();
  if (requests.length === 0) return failedAttemptsByApiRequestId;
  const requestById = new Map(requests.map((request) => [request.id, request]));
  const attemptRows = await prisma.apiRequest.findMany({
    where: { failedAttemptOfMessage: { apiRequestId: { in: [...requestById.keys()] } } },
    select: { ...FAILED_ATTEMPT_CHAIN_SELECT, failedAttemptOfMessage: { select: { apiRequestId: true } } },
  });
  // A request's chain, in file order: its attempts, then itself.
  const chainByApiRequestId = new Map<number, (FailedAttemptChainRow & { isAttempt: boolean })[]>();
  for (const attempt of attemptRows) {
    const request = requestById.get(attempt.failedAttemptOfMessage!.apiRequestId!);
    if (request === undefined || request.agentId !== attempt.agentId) continue;
    const chain = chainByApiRequestId.get(request.id) ?? [{ ...request, isAttempt: false }];
    chain.push({ ...attempt, isAttempt: true });
    chainByApiRequestId.set(request.id, chain);
  }
  for (const [apiRequestId, chain] of chainByApiRequestId) {
    chain.sort((a, b) => a.positionInFile - b.positionInFile || a.id - b.id);
    const failedAttempts: FailedAttempt[] = [];
    chain.forEach((row, index) => {
      if (!row.isAttempt) return;
      const nextSentAt = chain[index + 1]?.sentAt ?? null;
      failedAttempts.push({
        lostMs: row.sentAt === null || nextSentAt === null ? null : Number(nextSentAt - row.sentAt),
        sentAt: row.sentAt === null ? null : new Date(Number(row.sentAt)).toISOString(),
      });
    });
    failedAttemptsByApiRequestId.set(apiRequestId, failedAttempts);
  }
  return failedAttemptsByApiRequestId;
}

/** The interned system prompt and tool set an `api_request` row is read with. */
const SYSTEM_PROMPT_AND_TOOL_SET_INCLUDE = {
  systemPrompt: { select: { blocksJson: true } },
  toolSet: { select: { toolsJson: true } },
} as const;

/** The `api_request` row `apiRequestId`, with its system prompt and tool set; null for an unknown one. */
function findApiRequestRow(prisma: ReadPrisma, apiRequestId: number) {
  return prisma.apiRequest.findUnique({
    where: { id: apiRequestId },
    include: SYSTEM_PROMPT_AND_TOOL_SET_INCLUDE,
  });
}

/** What `read` makes of `api_request` row `apiRequestId`, read from the database at `dbPath`; null for an unknown row. */
function withApiRequestRow<Result>(
  apiRequestId: number,
  dbPath: string | undefined,
  read: (row: NonNullable<Awaited<ReturnType<typeof findApiRequestRow>>>, prisma: ReadPrisma) => Promise<Result | null>,
): Promise<Result | null> {
  return withReadClient(dbPath, async (prisma) => {
    const row = await findApiRequestRow(prisma, apiRequestId);
    return row === null ? null : await read(row, prisma);
  });
}

/**
 * The `api_request` row, with its system prompt and tool set, of the latest
 * Turn of `row`'s Agent that comes before `row`'s own Turn in the transcript
 * order and has one in another file; null when `row` has no Turn of its
 * Agent, or no earlier Turn has one.
 */
async function apiRequestOfPreviousTurn(prisma: ReadPrisma, row: { id: number; agentId: number }) {
  const turn = await prisma.message.findFirst({
    where: { agentId: row.agentId, apiRequestId: row.id },
    orderBy: TRANSCRIPT_ORDER,
    select: { id: true, timestamp: true },
  });
  if (turn === null) return null;
  const previousTurn = await prisma.message.findFirst({
    // A request of the row's own Agent found here is later in its file than the row.
    where: { AND: [{ agentId: row.agentId, apiRequest: { agentId: { not: row.agentId } } }, orderedBefore(turn)] },
    orderBy: REVERSE_TRANSCRIPT_ORDER,
    select: { apiRequest: { include: SYSTEM_PROMPT_AND_TOOL_SET_INCLUDE } },
  });
  return previousTurn?.apiRequest ?? null;
}

/** What the walk of a base chain needs of an `api_request` row. */
type MessageChainRow = {
  recordId: string;
  baseRecordId: string | null;
  keptMessageCount: number;
  tailMessageHashesJson: string;
  positionInFile: number;
};

/** A message's hash; null where the logs do not say which message stood there (a base that is in no request of the file). */
type MessageHash = string | null;

/**
 * Read the requests of `row`'s Agent up to it, once, and return what gives
 * the message hashes of any of them (log-format §9, step 1): the first
 * `keep` of its base's, then its tail — its base being the latest earlier
 * request of the file with that record id, and a base the file does not hold
 * leaving its `keep` messages unknown.
 */
async function messageHashesOfAgentRequests(
  prisma: ReadPrisma,
  row: { agentId: number; positionInFile: number },
): Promise<(request: MessageChainRow) => MessageHash[]> {
  const agentRequests = await prisma.apiRequest.findMany({
    where: { agentId: row.agentId, positionInFile: { lte: row.positionInFile } },
    orderBy: { positionInFile: "asc" },
    select: {
      recordId: true,
      baseRecordId: true,
      keptMessageCount: true,
      tailMessageHashesJson: true,
      positionInFile: true,
    },
  });
  const requestsByRecordId = new Map<string, MessageChainRow[]>();
  for (const request of agentRequests) {
    requestsByRecordId.set(request.recordId, [...(requestsByRecordId.get(request.recordId) ?? []), request]);
  }
  const baseOf = (request: MessageChainRow): MessageChainRow | undefined =>
    request.baseRecordId === null
      ? undefined
      : requestsByRecordId
          .get(request.baseRecordId)
          ?.findLast((candidate) => candidate.positionInFile < request.positionInFile);
  return (request) => {
    const chain = [request];
    for (let base = baseOf(request); base !== undefined; base = baseOf(base)) chain.unshift(base);
    let messageHashes: MessageHash[] = [];
    for (const link of chain) {
      const keptMessageHashes = Array.from(
        { length: link.keptMessageCount },
        (_, index) => messageHashes[index] ?? null,
      );
      // Every column was written by `JSON.stringify` (refresh.ts).
      messageHashes = [...keptMessageHashes, ...(JSON.parse(link.tailMessageHashesJson) as string[])];
    }
    return messageHashes;
  };
}

/**
 * The length of the longest prefix two requests' message hashes share: equal
 * hashes match whether or not their messages could be rebuilt, and a position
 * whose hash is unknown (null) never matches.
 */
function sharedMessageHashPrefixLength(messageHashes: MessageHash[], previousMessageHashes: MessageHash[]): number {
  let length = 0;
  while (
    length < Math.min(messageHashes.length, previousMessageHashes.length) &&
    messageHashes[length] !== null &&
    messageHashes[length] === previousMessageHashes[length]
  ) {
    length += 1;
  }
  return length;
}

/** What {@link bodyWithoutMessagesOf} needs of an `api_request` row. */
type ApiRequestRow = {
  parametersJson: string;
  cacheBreakpointsJson: string;
  systemPrompt: { blocksJson: string } | null;
  toolSet: { toolsJson: string } | null;
};

/**
 * The body of an API request: what its row holds (see {@link bodyWithoutMessagesOf}),
 * then the messages of `messageHashes` as stored — null for one the database
 * does not hold, or whose hash is unknown — each carrying the `cache_control`
 * its breakpoints set at `["messages", i, "content", j]`. Beside it, the
 * pieces of Injected context of each message, at its index; none for a
 * message missing.
 */
async function requestOf(
  prisma: ReadPrisma,
  row: ApiRequestRow,
  messageHashes: MessageHash[],
): Promise<{ body: RequestBody; injectedContextPiecesOfMessages: InjectedContextPiece[][] }> {
  const sentMessageRows = await prisma.sentMessage.findMany({
    where: { hash: { in: [...new Set(messageHashes.filter((hash) => hash !== null))] } },
  });
  const sentMessageRowByHash = new Map(sentMessageRows.map((sentMessageRow) => [sentMessageRow.hash, sentMessageRow]));
  const sentMessageRowsInOrder = messageHashes.map((hash) =>
    hash === null ? undefined : sentMessageRowByHash.get(hash),
  );
  const messages = sentMessageRowsInOrder.map((sentMessageRow) =>
    sentMessageRow === undefined ? null : (JSON.parse(sentMessageRow.messageJson) as JsonValue),
  );
  return {
    body: {
      ...bodyWithoutMessagesOf(row),
      messages: withMessageCacheBreakpoints(messages, JSON.parse(row.cacheBreakpointsJson) as JsonValue),
    },
    // Every column was written by `JSON.stringify` (refresh.ts).
    injectedContextPiecesOfMessages: sentMessageRowsInOrder.map((sentMessageRow) =>
      sentMessageRow?.injectedContextPiecesJson == null
        ? []
        : (JSON.parse(sentMessageRow.injectedContextPiecesJson) as InjectedContextPiece[]),
    ),
  };
}

/**
 * The body an API request's row holds without its messages: its
 * parameters, then its system blocks — each carrying the `cache_control` its
 * breakpoints set at `["system", i]` — and its tools; a system prompt or tool set its file lacked
 * is left out.
 */
function bodyWithoutMessagesOf(row: ApiRequestRow): RequestBody {
  // Every column was written by `JSON.stringify` (refresh.ts).
  const body = JSON.parse(row.parametersJson) as RequestBody;
  if (row.systemPrompt !== null) {
    const systemBlocks = JSON.parse(row.systemPrompt.blocksJson) as JsonValue;
    body.system = Array.isArray(systemBlocks)
      ? withSystemCacheBreakpoints(systemBlocks, JSON.parse(row.cacheBreakpointsJson) as JsonValue)
      : systemBlocks;
  }
  if (row.toolSet !== null) body.tools = JSON.parse(row.toolSet.toolsJson) as JsonValue;
  return body;
}

/** The well-formed cache breakpoints of `cacheBreakpoints`: each `path`, and the `value` set there. */
function cacheBreakpointsOf(cacheBreakpoints: JsonValue): { path: JsonValue[]; value: JsonValue }[] {
  return (Array.isArray(cacheBreakpoints) ? cacheBreakpoints : []).flatMap((breakpoint) =>
    isPlainObject(breakpoint) && Array.isArray(breakpoint.path) && breakpoint.value !== undefined
      ? [{ path: breakpoint.path, value: breakpoint.value }]
      : [],
  );
}

/** `systemBlocks` with each breakpoint at a path `["system", i]` set as block `i`'s `cache_control`. */
function withSystemCacheBreakpoints(systemBlocks: JsonValue[], cacheBreakpoints: JsonValue): JsonValue[] {
  const blocks = [...systemBlocks];
  for (const { path, value } of cacheBreakpointsOf(cacheBreakpoints)) {
    const [part, index] = path;
    const block = typeof index === "number" ? blocks[index] : undefined;
    if (path.length !== 2 || part !== "system" || !isPlainObject(block)) continue;
    blocks[index as number] = { ...block, cache_control: value };
  }
  return blocks;
}

/**
 * `messages` with each breakpoint at a path `["messages", i, "content", j]`
 * set as the `cache_control` of message `i`'s content block `j` — none on a
 * message missing, or whose content is a string.
 */
function withMessageCacheBreakpoints(
  messages: (JsonValue | null)[],
  cacheBreakpoints: JsonValue,
): (JsonValue | null)[] {
  const breakpointMessages = [...messages];
  for (const { path, value } of cacheBreakpointsOf(cacheBreakpoints)) {
    const [part, messageIndex, contentField, blockIndex] = path;
    if (path.length !== 4 || part !== "messages" || contentField !== "content") continue;
    const message = typeof messageIndex === "number" ? breakpointMessages[messageIndex] : undefined;
    if (!isPlainObject(message) || !Array.isArray(message.content) || typeof blockIndex !== "number") continue;
    const block = message.content[blockIndex];
    if (!isPlainObject(block)) continue;
    const content = [...message.content];
    content[blockIndex] = { ...block, cache_control: value };
    breakpointMessages[messageIndex as number] = { ...message, content };
  }
  return breakpointMessages;
}

/** The body parts a cache breakpoint can be set on. */
const CACHE_BREAKPOINT_PARTS = new Set<JsonValue>(["system", "tools", "messages"]);

/** The parameters of `body`, sent with `cacheBreakpoints`. */
function sentParameters(body: RequestBody, cacheBreakpoints: JsonValue): SentParameters {
  const outputConfig = body.output_config;
  const effort = isPlainObject(outputConfig) && typeof outputConfig.effort === "string" ? outputConfig.effort : null;
  const bodyBetas = Array.isArray(body.betas) ? body.betas.filter((beta) => typeof beta === "string") : [];
  const betas = [...new Set(bodyBetas.map((beta) => beta.trim()).filter(Boolean))];
  return {
    model: typeof body.model === "string" ? body.model : null,
    maxTokens: typeof body.max_tokens === "number" ? body.max_tokens : null,
    thinking: body.thinking === undefined ? null : thinkingText(body.thinking),
    effort,
    betas,
    cacheBreakpointCount: cacheBreakpointsOf(cacheBreakpoints).filter(({ path }) =>
      CACHE_BREAKPOINT_PARTS.has(path[0] ?? null),
    ).length,
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

/** The system-prompt diff from `previousBody` to `body`; null when the system text is the same. */
function systemPromptDiff(previousBody: RequestBody, body: RequestBody): SystemPromptDiff | null {
  const volatileChangeNames = new Set<VolatileChangeName>();
  const hunks = lineDiffHunks(systemTextOf(previousBody), systemTextOf(body)).map((hunk) => ({
    lines: hunk.lines.map((line) => {
      const volatileChangeName =
        line.change === "unchanged"
          ? undefined
          : VOLATILE_SYSTEM_LINE_PATTERNS.find(({ pattern }) => pattern.test(line.text))?.name;
      if (volatileChangeName !== undefined) volatileChangeNames.add(volatileChangeName);
      return { ...line, isVolatile: volatileChangeName !== undefined };
    }),
  }));
  if (hunks.length === 0) return null;
  const changedLines = hunks.flatMap((hunk) => hunk.lines).filter((line) => line.change !== "unchanged");
  return {
    hunks,
    isVolatileOnly: changedLines.every((line) => line.isVolatile),
    volatileChangeNames: [...volatileChangeNames],
  };
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

/**
 * `messages` as sent, in order, each part labelled: a piece of Injected
 * context by its kind, from `injectedContextPiecesOfMessages` at the message's
 * index; a tool result by the tool of the call an earlier message made; null
 * kept for one the logs could not rebuild.
 */
function sentMessagesOf(
  messages: (JsonValue | null)[],
  injectedContextPiecesOfMessages: InjectedContextPiece[][],
): (SentMessage | null)[] {
  const toolNameByUseId = new Map<string, string>();
  return messages.map((message, messageIndex) => {
    if (message === null) return null;
    const role = isPlainObject(message) && typeof message.role === "string" ? message.role : "unknown";
    const blocks = contentBlocksOf(message);
    const injectedContextPieces = injectedContextPiecesOfMessages[messageIndex] ?? [];
    const sent = {
      role,
      parts: blocks.flatMap((block, blockIndex) =>
        sentMessageParts(
          block,
          role,
          injectedContextPieces.filter((piece) => piece.blockIndex === blockIndex),
          toolNameByUseId,
        ),
      ),
    };
    for (const block of blocks) {
      if (isPlainObject(block) && block.type === "tool_use" && typeof block.id === "string") {
        toolNameByUseId.set(block.id, typeof block.name === "string" ? block.name : "unnamed");
      }
    }
    return sent;
  });
}

/** The content blocks of `message`: a string content is one block, a missing one none, a message that is no object one. */
function contentBlocksOf(message: unknown): unknown[] {
  if (!isPlainObject(message)) return [message];
  const content = message.content;
  return Array.isArray(content) ? content : content === undefined ? [] : [content];
}

/** How long a sent part's preview gets before it is cut. */
const SENT_PART_PREVIEW_MAX_CHARS = 120;

/** The kind of every part of Injected context. */
const INJECTED_CONTEXT_KIND: SentBlockKind = "injected-context";

/** The label of a part of Injected context no attachment names. */
const INJECTED_CONTEXT_LABEL = "Injected context";

/**
 * The parts of `block` of a message from `role`, labelled, the tool of a
 * result found in `toolNameByUseId`: one per piece of `injectedContextPieces`
 * and per run of text around them, or the block whole without any.
 */
function sentMessageParts(
  block: unknown,
  role: string,
  injectedContextPieces: InjectedContextPiece[],
  toolNameByUseId: Map<string, string>,
): SentMessagePart[] {
  const sent = sentBlock(block);
  if (sent.shownAs === "text" && injectedContextPieces.length > 0) {
    return injectedContextParts(sent.text, injectedContextPieces);
  }
  const fields = isPlainObject(block) ? block : {};
  // A system message's text never comes from the person: it is Injected context.
  const kindOfPart = sent.kind === "text" && role === "system" ? INJECTED_CONTEXT_KIND : sent.kind;
  const part = { ...sent, kind: kindOfPart };
  return [
    { ...part, label: sentPartLabel(part, fields, role, toolNameByUseId), preview: sentPartPreview(part, fields) },
  ];
}

/**
 * The text of a block holding `injectedContextPieces` as one part per piece,
 * labelled by its kind, and one per non-blank run of text around them,
 * labelled {@link INJECTED_CONTEXT_LABEL}: each its text exactly as sent.
 */
function injectedContextParts(text: string, injectedContextPieces: InjectedContextPiece[]): SentMessagePart[] {
  const parts: SentMessagePart[] = [];
  const addPart = (partText: string, label: string) => {
    const sent: SentBlock = { kind: INJECTED_CONTEXT_KIND, shownAs: "text", text: partText };
    parts.push({ ...sent, label, preview: sentPartPreview(sent, {}) });
  };
  let residueStart = 0;
  for (const piece of injectedContextPieces.toSorted((a, b) => a.start - b.start)) {
    const residue = text.slice(residueStart, piece.start);
    if (residue.trim() !== "") addPart(residue, INJECTED_CONTEXT_LABEL);
    addPart(text.slice(piece.start, piece.end), injectedContextLabel(piece));
    residueStart = Math.max(residueStart, piece.end);
  }
  const residue = text.slice(residueStart);
  if (residue.trim() !== "") addPart(residue, INJECTED_CONTEXT_LABEL);
  return parts;
}

/** The label of each kind of Injected context that is not its attachment type made readable. */
const INJECTED_CONTEXT_LABEL_BY_KIND = new Map<AttachmentType, string>([
  ["skill_listing", "Skill list"],
  ["agent_listing_delta", "Agent list"],
  ["mcp_instructions_delta", "MCP server instructions"],
  ["deferred_tools_delta", "Deferred tools"],
  ["total_tokens_reminder", "Token budget"],
  ["edited_text_file", "File changed outside Claude"],
  ["queued_command", "Queued message"],
]);

/**
 * What a piece of Injected context is to a reader: for `instructions`, the
 * distinct names of its files in order (`CLAUDE.md · AGENTS.md`); else the
 * label of {@link INJECTED_CONTEXT_LABEL_BY_KIND}, or its attachment type made
 * readable (`bash_output_audience_note` → "Bash output audience note").
 */
function injectedContextLabel(piece: InjectedContextPiece): string {
  const fileNames = [...new Set((piece.instructionFilePaths ?? []).map((filePath) => filePath.split(/[\\/]/).at(-1)!))];
  if (piece.kind === "instructions" && fileNames.length > 0) return fileNames.join(" · ");
  const label = INJECTED_CONTEXT_LABEL_BY_KIND.get(piece.kind);
  if (label !== undefined) return label;
  const words = piece.kind.replaceAll("_", " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** See {@link SentMessagePart.label}. */
function sentPartLabel(
  sent: SentBlock,
  fields: Record<string, unknown>,
  role: string,
  toolNameByUseId: Map<string, string>,
): string {
  switch (sent.kind) {
    case INJECTED_CONTEXT_KIND:
      return INJECTED_CONTEXT_LABEL;
    case "text":
      if (role === "user") return "Prompt";
      return role === "assistant" ? "Assistant text" : sent.kind;
    case "tool_use":
      return typeof fields.name === "string" ? `Tool call · ${fields.name}` : "Tool call";
    case "tool_result": {
      const toolName = typeof fields.tool_use_id === "string" ? toolNameByUseId.get(fields.tool_use_id) : undefined;
      return toolName === undefined ? "Tool result" : `Tool result · ${toolName}`;
    }
    case "thinking":
      return "Thinking";
    case "image":
      return "Image";
    default:
      return sent.kind;
  }
}

/** See {@link SentMessagePart.preview}. */
function sentPartPreview(sent: SentBlock, fields: Record<string, unknown>): string {
  if (sent.shownAs === "text") return previewLineOf(sent.text.replace(SYSTEM_REMINDER_TAG_PATTERN, ""));
  if (sent.kind === "tool_use") return previewLineOf(JSON.stringify(fields.input ?? {}));
  if (sent.kind !== "tool_result") return "";
  const content = fields.content;
  if (typeof content === "string") return previewLineOf(content);
  if (!Array.isArray(content)) return "";
  return previewLineOf(
    content
      .filter((part) => isPlainObject(part) && typeof part.text === "string")
      .map((part) => (part as { text: string }).text)
      .join("\n"),
  );
}

/** The first non-blank line of `text`, trimmed, cut at {@link SENT_PART_PREVIEW_MAX_CHARS} characters then "…"; empty without one. */
function previewLineOf(text: string): string {
  const line = text
    .split("\n")
    .map((candidate) => candidate.trim())
    .find((candidate) => candidate !== "");
  if (line === undefined) return "";
  return line.length > SENT_PART_PREVIEW_MAX_CHARS ? `${line.slice(0, SENT_PART_PREVIEW_MAX_CHARS)}…` : line;
}

/** The tag opening a system-reminder: context Claude Code injects into a text block. */
const SYSTEM_REMINDER_TAG = "<system-reminder>";
/** A system-reminder's opening or closing tag, anywhere in a text. */
const SYSTEM_REMINDER_TAG_PATTERN = /<\/?system-reminder>/g;

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
      kind: text.trimStart().startsWith(SYSTEM_REMINDER_TAG) ? INJECTED_CONTEXT_KIND : "text",
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

/** The system blocks of `body`: a string system prompt is one block. */
function systemBlocksOf(body: RequestBody): unknown[] {
  if (Array.isArray(body.system)) return body.system;
  return body.system === undefined ? [] : [body.system];
}

function toolsOf(body: RequestBody): unknown[] {
  return Array.isArray(body.tools) ? body.tools : [];
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
