// Every SQL statement `refresh()` runs, in one place (ADR-0005). The Refresh
// writes through a bare better-sqlite3 connection rather than Prisma, so this
// module mirrors `schema.prisma` by hand: a column added, renamed or removed
// there must be followed here. `stored-data-equivalence.test.ts` catches a miss.

import path from "node:path";
import type Database from "better-sqlite3";

/** A value SQLite stores; booleans are written as 0/1 (see `toSqlValue`). */
type SqlValue = string | number | bigint | boolean | null;

/** One row to insert, keyed by its field name in `schema.prisma`. */
type InsertRow<Field extends string> = Record<Field, SqlValue>;

/** better-sqlite3 binds no booleans: store them as Prisma does, 0 or 1. */
function toSqlValue(value: SqlValue): string | number | bigint | null {
  if (typeof value === "boolean") return value ? 1 : 0;
  return value;
}

/**
 * Prepare one INSERT into `table`, its columns given as `{ field: "column" }`,
 * and return a function that inserts a row and returns the new row's id.
 */
function prepareInsert<Field extends string>(
  db: Database.Database,
  table: string,
  columnByField: Record<Field, string>,
): (row: InsertRow<Field>) => number {
  const fields = Object.keys(columnByField) as Field[];
  const columnList = fields.map((field) => `"${columnByField[field]}"`).join(", ");
  const placeholders = fields.map(() => "?").join(", ");
  const statement = db.prepare(`INSERT INTO "${table}" (${columnList}) VALUES (${placeholders})`);
  return (row) => Number(statement.run(fields.map((field) => toSqlValue(row[field]))).lastInsertRowid);
}

/**
 * Prepare one UPDATE of every column of a `table` row, its columns given as
 * `{ field: "column" }`, and return a function that rewrites the row of id `id`.
 */
function prepareUpdate<Field extends string>(
  db: Database.Database,
  table: string,
  columnByField: Record<Field, string>,
): (id: number, row: InsertRow<Field>) => void {
  const fields = Object.keys(columnByField) as Field[];
  const assignments = fields.map((field) => `"${columnByField[field]}" = ?`).join(", ");
  const statement = db.prepare(`UPDATE "${table}" SET ${assignments} WHERE "id" = ?`);
  return (id, row) => void statement.run([...fields.map((field) => toSqlValue(row[field])), id]);
}

const PROJECT_COLUMN_BY_FIELD = { path: "path" } as const;

const CONVERSATION_COLUMN_BY_FIELD = {
  sessionId: "session_id",
  projectId: "project_id",
  projectPathFromRecords: "project_path_from_records",
  title: "title",
  gitBranch: "git_branch",
  ccVersion: "cc_version",
  sourcePath: "source_path",
  sourceMtime: "source_mtime",
  sourceSize: "source_size",
  parserVersion: "parser_version",
  continuedFromConversationId: "continued_from_conversation_id",
} as const;

/** The columns of an `agent` row its parent's spawn ledger decides (see `refresh.ts`). */
const AGENT_LINEAGE_COLUMN_BY_FIELD = {
  parentAgentId: "parent_agent_id",
  spawnedByMessageId: "spawned_by_message_id",
  agentType: "agent_type",
  resolvedModel: "resolved_model",
} as const;

const AGENT_COLUMN_BY_FIELD = {
  conversationId: "conversation_id",
  externalAgentId: "external_agent_id",
  ...AGENT_LINEAGE_COLUMN_BY_FIELD,
  sourceMtime: "source_mtime",
  sourceSize: "source_size",
  sourcePath: "source_path",
} as const;

const MESSAGE_COLUMN_BY_FIELD = {
  conversationId: "conversation_id",
  agentId: "agent_id",
  messageId: "message_id",
  requestId: "request_id",
  uuid: "uuid",
  role: "role",
  kind: "kind",
  text: "text",
  origin: "origin",
  inputTokens: "input_tokens",
  outputTokens: "output_tokens",
  cacheCreation5mTokens: "cache_creation_5m_tokens",
  cacheCreation1hTokens: "cache_creation_1h_tokens",
  cacheReadTokens: "cache_read_tokens",
  model: "model",
  effort: "effort",
  thinkingText: "thinking_text",
  thinkingDurationMs: "thinking_duration_ms",
  attributionSkill: "attribution_skill",
  attributionAgent: "attribution_agent",
  attributionPlugin: "attribution_plugin",
  attributionMcpServer: "attribution_mcp_server",
  permissionMode: "permission_mode",
  isApiError: "is_api_error",
  apiErrorMessage: "api_error_message",
  timestamp: "timestamp",
  requestRef: "request_ref",
} as const;

const TOOL_CALL_COLUMN_BY_FIELD = {
  messageId: "message_id",
  agentId: "agent_id",
  toolUseId: "tool_use_id",
  name: "name",
  inputJson: "input_json",
  resultText: "result_text",
  resultTruncated: "result_truncated",
  resultCharSize: "result_char_size",
  isError: "is_error",
} as const;

const PR_LINK_COLUMN_BY_FIELD = {
  conversationId: "conversation_id",
  prNumber: "pr_number",
  prUrl: "pr_url",
  prRepository: "pr_repository",
} as const;

const TURN_DURATION_COLUMN_BY_FIELD = {
  conversationId: "conversation_id",
  durationMs: "duration_ms",
  messageCount: "message_count",
} as const;

const CONTINUED_IN_COLUMN_BY_FIELD = {
  conversationId: "conversation_id",
  sessionId: "session_id",
} as const;

const API_REQUEST_COLUMN_BY_FIELD = {
  conversationId: "conversation_id",
  agentId: "agent_id",
  failedAttemptOfMessageId: "failed_attempt_of_message_id",
  recordId: "record_id",
  baseRecordId: "base_record_id",
  keptMessageCount: "kept_message_count",
  tailMessageHashesJson: "tail_message_hashes_json",
  parametersJson: "parameters_json",
  cacheBreakpointsJson: "cache_breakpoints_json",
  querySource: "query_source",
  requestDigest: "request_digest",
  sentAt: "sent_at",
  positionInFile: "position_in_file",
  systemPromptHash: "system_prompt_hash",
  toolSetHash: "tool_set_hash",
} as const;

const TURN_COLUMN_BY_FIELD = {
  messageId: "message_id",
  agentId: "agent_id",
  conversationId: "conversation_id",
  inputTokens: "input_tokens",
  outputTokens: "output_tokens",
  cacheCreation5mTokens: "cache_creation_5m_tokens",
  cacheCreation1hTokens: "cache_creation_1h_tokens",
  cacheReadTokens: "cache_read_tokens",
  model: "model",
} as const;

/** A `project` row to insert. */
export type ProjectRow = InsertRow<keyof typeof PROJECT_COLUMN_BY_FIELD>;
/** A `conversation` row to insert. */
export type ConversationRow = InsertRow<keyof typeof CONVERSATION_COLUMN_BY_FIELD>;
/** An `agent` row to insert. */
export type AgentRow = InsertRow<keyof typeof AGENT_COLUMN_BY_FIELD>;
/** A `message` row to insert. */
export type MessageRow = InsertRow<keyof typeof MESSAGE_COLUMN_BY_FIELD>;
/** A `tool_call` row to insert. */
export type ToolCallRow = InsertRow<keyof typeof TOOL_CALL_COLUMN_BY_FIELD>;
/** A `pr_link` row to insert. */
export type PrLinkRow = InsertRow<keyof typeof PR_LINK_COLUMN_BY_FIELD>;
/** A `turn_duration` row to insert. */
export type TurnDurationRow = InsertRow<keyof typeof TURN_DURATION_COLUMN_BY_FIELD>;
/** An `api_request` row to insert. */
export type ApiRequestRow = InsertRow<keyof typeof API_REQUEST_COLUMN_BY_FIELD>;
/** A `continued_in` row to insert. */
export type ContinuedInRow = InsertRow<keyof typeof CONTINUED_IN_COLUMN_BY_FIELD>;
/** A `turn` row to write. */
export type TurnRow = {
  messageId: number;
  agentId: number;
  conversationId: number;
  inputTokens: number;
  outputTokens: number;
  cacheCreation5mTokens: number;
  cacheCreation1hTokens: number;
  cacheReadTokens: number;
  model: string | null;
};

/** One occurrence of a Turn identified across the logs, as deciding its owner and usage needs it. */
export type TurnOccurrence = {
  /** Its `message` row id. */
  id: number;
  agentId: number;
  conversationId: number;
  /** Its Agent's `source_path`; NULL only on rows predating the column. */
  sourcePath: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  cacheCreation5mTokens: number | null;
  cacheCreation1hTokens: number | null;
  cacheReadTokens: number | null;
  model: string | null;
};

/** What deciding a stored Conversation's parent needs of it (log-format §10). */
export type ContinuationCandidate = {
  id: number;
  sessionId: string;
  sourcePath: string;
  /** Row id of its Main thread's Agent. */
  mainThreadAgentId: number;
};

/** What the skip/changed/delete decision needs of a stored Conversation. */
export type StoredConversation = {
  id: number;
  sessionId: string;
  sourcePath: string;
  sourceMtime: number;
  sourceSize: number;
  parserVersion: number;
};

/** What re-parsing a changed Conversation needs of one of its stored Agents. */
export type StoredAgent = {
  id: number;
  /** NULL for the Main thread. */
  externalAgentId: string | null;
  parentAgentId: number | null;
  spawnedByMessageId: number | null;
  agentType: string | null;
  resolvedModel: string | null;
  /** NULL: no change key recorded. */
  sourceMtime: number | null;
  sourceSize: number | null;
};

/** An `agent` row's lineage columns, to rewrite in place. */
export type AgentLineageRow = InsertRow<keyof typeof AGENT_LINEAGE_COLUMN_BY_FIELD>;

/** The statements of one Refresh, prepared once on its connection. */
export type RefreshStatements = ReturnType<typeof prepareRefreshStatements>;

/**
 * Prepare every statement a Refresh runs on `db`, once, for reuse across all
 * its Conversations. Each insert returns the new row's id.
 *
 * @example
 * const statements = prepareRefreshStatements(openRefreshConnection(dbPath));
 */
export function prepareRefreshStatements(db: Database.Database) {
  const begin = db.prepare("BEGIN IMMEDIATE");
  const commit = db.prepare("COMMIT");
  const selectStoredConversations = db.prepare(
    `SELECT "id", "session_id" AS "sessionId", "source_path" AS "sourcePath", "source_mtime" AS "sourceMtime",
            "source_size" AS "sourceSize", "parser_version" AS "parserVersion"
       FROM "conversation"`,
  );
  const deleteConversation = db.prepare(`DELETE FROM "conversation" WHERE "id" = ?`);
  const selectStoredAgents = db.prepare(
    `SELECT "id", "external_agent_id" AS "externalAgentId", "parent_agent_id" AS "parentAgentId",
            "spawned_by_message_id" AS "spawnedByMessageId", "agent_type" AS "agentType",
            "resolved_model" AS "resolvedModel", "source_mtime" AS "sourceMtime", "source_size" AS "sourceSize"
       FROM "agent" WHERE "conversation_id" = ?`,
  );
  const deleteAgent = db.prepare(`DELETE FROM "agent" WHERE "id" = ?`);
  // Of several Tool calls with the id, the first in file order — as the
  // Message holding it is the first in file order that does.
  const selectSpawningMessageId = db
    .prepare(`SELECT "message_id" FROM "tool_call" WHERE "agent_id" = ? AND "tool_use_id" = ? ORDER BY "id" LIMIT 1`)
    .pluck();
  const selectHoldingAgentIds = db
    .prepare(`SELECT DISTINCT "agent_id" FROM "message" WHERE "uuid" = ? AND "conversation_id" = ?`)
    .pluck();
  // Through the `agent_id` index: `tool_use_id` has none of its own.
  const selectToolUseHoldingAgentIds = db
    .prepare(
      `SELECT DISTINCT "agent_id" FROM "tool_call"
        WHERE "agent_id" IN (SELECT "value" FROM json_each(?)) AND "tool_use_id" = ?`,
    )
    .pluck();
  const deletePrLinks = db.prepare(`DELETE FROM "pr_link" WHERE "conversation_id" = ?`);
  const deleteTurnDurations = db.prepare(`DELETE FROM "turn_duration" WHERE "conversation_id" = ?`);
  const deleteContinuedIn = db.prepare(`DELETE FROM "continued_in" WHERE "conversation_id" = ?`);
  const updateContinuedFrom = db.prepare(
    `UPDATE "conversation" SET "continued_from_conversation_id" = ? WHERE "id" = ?`,
  );
  // The ids go in as one JSON array, so any number of them binds to one parameter.
  const selectContinuationIds = db
    .prepare(
      `SELECT "id" FROM "conversation"
        WHERE "continued_from_conversation_id" IN (SELECT "value" FROM json_each(?))`,
    )
    .pluck();
  const selectConversationIdsBySessionId = db
    .prepare(`SELECT "id" FROM "conversation" WHERE "session_id" IN (SELECT "value" FROM json_each(?))`)
    .pluck();
  const selectContinuationCandidate = db.prepare(
    `SELECT "conversation"."id", "conversation"."session_id" AS "sessionId",
            "conversation"."source_path" AS "sourcePath", "agent"."id" AS "mainThreadAgentId"
       FROM "conversation"
       JOIN "agent" ON "agent"."conversation_id" = "conversation"."id" AND "agent"."external_agent_id" IS NULL
      WHERE "conversation"."id" = ?`,
  );
  const selectFirstMessageUuid = db
    .prepare(`SELECT "uuid" FROM "message" WHERE "agent_id" = ? ORDER BY "id" LIMIT 1`)
    .pluck();
  // A uuid is not unique: a continuation copies its parent's records with
  // their uuids (log-format §10). In `source_path` order, so the smallest
  // path wins a tie wherever these are compared.
  const selectOtherHolders = db.prepare(
    `SELECT "conversation"."id", "conversation"."session_id" AS "sessionId",
            "conversation"."source_path" AS "sourcePath", "agent"."id" AS "mainThreadAgentId"
       FROM "conversation"
       JOIN "agent" ON "agent"."conversation_id" = "conversation"."id" AND "agent"."external_agent_id" IS NULL
      WHERE "conversation"."id" IN (SELECT "conversation_id" FROM "message" WHERE "uuid" = @uuid)
        AND "conversation"."id" <> @excludedConversationId
      ORDER BY "conversation"."source_path"`,
  );
  // Of the Conversations whose `continued-in` record names the session, the
  // one with the smallest `source_path`.
  const selectNamingConversationId = db
    .prepare(
      `SELECT "conversation"."id" FROM "continued_in"
         JOIN "conversation" ON "conversation"."id" = "continued_in"."conversation_id"
        WHERE "continued_in"."session_id" = @sessionId AND "conversation"."id" <> @conversationId
        ORDER BY "conversation"."source_path"
        LIMIT 1`,
    )
    .pluck();
  const selectIsSessionNamed = db
    .prepare(`SELECT 1 FROM "continued_in" WHERE "conversation_id" = ? AND "session_id" = ? LIMIT 1`)
    .pluck();
  const selectIsEveryMessageHeld = db
    .prepare(
      `SELECT NOT EXISTS (
         SELECT 1 FROM "message" AS "held"
          WHERE "held"."agent_id" = @agentId
            AND ("held"."uuid" IS NULL OR NOT EXISTS (
              SELECT 1 FROM "message" AS "holding"
               WHERE "holding"."uuid" = "held"."uuid" AND "holding"."agent_id" = @holdingAgentId)))`,
    )
    .pluck();
  // How many of the Agent's Messages, from its first, the other Agent holds:
  // up to the first one it does not, in file order (row id order).
  const selectSharedLeadingRunLength = db
    .prepare(
      `SELECT COUNT(*) FROM "message"
        WHERE "agent_id" = @agentId
          AND "id" < COALESCE(
            (SELECT "own"."id" FROM "message" AS "own"
              WHERE "own"."agent_id" = @agentId
                AND ("own"."uuid" IS NULL OR NOT EXISTS (
                  SELECT 1 FROM "message" AS "holding"
                   WHERE "holding"."uuid" = "own"."uuid" AND "holding"."agent_id" = @holdingAgentId))
              ORDER BY "own"."id"
              LIMIT 1),
            9223372036854775807)`,
    )
    .pluck();
  const clearCopiedMessages = db.prepare(
    `UPDATE "message" SET "is_copied" = 0 WHERE "conversation_id" = ? AND "is_copied" = 1`,
  );
  // THE RULE for a Copied Message (log-format §10): in its Agent's leading
  // run of Messages that an Agent of the parent Conversation, or the Agent
  // that spawned it, holds. Each Agent's first Message neither holds is found
  // once. Without a parent Conversation, `@parentConversationId` is NULL and
  // matches no Message.
  const updateCopiedMessages = db.prepare(
    `WITH "first_own" AS MATERIALIZED (
       SELECT "agent"."id" AS "agent_id",
              (SELECT "own"."id" FROM "message" AS "own"
                WHERE "own"."agent_id" = "agent"."id"
                  AND ("own"."uuid" IS NULL OR (
                    NOT EXISTS (
                      SELECT 1 FROM "message" AS "holding"
                       WHERE "holding"."uuid" = "own"."uuid" AND "holding"."conversation_id" = @parentConversationId)
                    AND NOT EXISTS (
                      SELECT 1 FROM "message" AS "holding"
                       WHERE "holding"."uuid" = "own"."uuid" AND "holding"."agent_id" = "agent"."parent_agent_id")))
                ORDER BY "own"."id"
                LIMIT 1) AS "message_id"
         FROM "agent" WHERE "agent"."conversation_id" = @conversationId)
     UPDATE "message" SET "is_copied" = 1
      WHERE "conversation_id" = @conversationId
        AND "id" < COALESCE(
          (SELECT "message_id" FROM "first_own" WHERE "first_own"."agent_id" = "message"."agent_id"),
          9223372036854775807)`,
  );
  // A Turn with a `requestId` is identified by its message id across all the
  // logs (ADR-0011): its key. One without is its own file's, and keyless.
  const selectTurnKeysOfAgent = db
    .prepare(`SELECT DISTINCT "message_id" FROM "message" WHERE "agent_id" = ? AND "request_id" IS NOT NULL`)
    .pluck();
  const selectTurnKeysOfConversation = db
    .prepare(`SELECT DISTINCT "message_id" FROM "message" WHERE "conversation_id" = ? AND "request_id" IS NOT NULL`)
    .pluck();
  const selectTurnKeyHolderConversationIds = db
    .prepare(
      `SELECT DISTINCT "conversation_id" FROM "message"
        WHERE "message_id" IN (SELECT "value" FROM json_each(?)) AND "request_id" IS NOT NULL
          AND "conversation_id" <> ?`,
    )
    .pluck();
  const selectTurnOccurrences = db.prepare(
    `SELECT "message"."id", "message"."agent_id" AS "agentId", "message"."conversation_id" AS "conversationId",
            "agent"."source_path" AS "sourcePath",
            "message"."input_tokens" AS "inputTokens", "message"."output_tokens" AS "outputTokens",
            "message"."cache_creation_5m_tokens" AS "cacheCreation5mTokens",
            "message"."cache_creation_1h_tokens" AS "cacheCreation1hTokens",
            "message"."cache_read_tokens" AS "cacheReadTokens", "message"."model"
       FROM "message" JOIN "agent" ON "agent"."id" = "message"."agent_id"
      WHERE "message"."message_id" = ? AND "message"."request_id" IS NOT NULL
      ORDER BY "message"."id"`,
  );
  const selectParentAgentId = db.prepare(`SELECT "parent_agent_id" FROM "agent" WHERE "id" = ?`).pluck();
  const selectContinuedFromId = db
    .prepare(`SELECT "continued_from_conversation_id" FROM "conversation" WHERE "id" = ?`)
    .pluck();
  // The other occurrences' rows of a Turn whose owner is `@ownerMessageId`.
  const deleteTurnsOfOtherOccurrences = db.prepare(
    `DELETE FROM "turn"
      WHERE "message_id" IN (SELECT "id" FROM "message" WHERE "message_id" = @turnKey AND "request_id" IS NOT NULL)
        AND "message_id" <> @ownerMessageId`,
  );
  // Rewritten only when a value differs, so a Turn re-resolved to what it was costs no write.
  const turnColumns = Object.values(TURN_COLUMN_BY_FIELD);
  const upsertTurn = db.prepare(
    `INSERT INTO "turn" (${turnColumns.map((column) => `"${column}"`).join(", ")})
       VALUES (${Object.keys(TURN_COLUMN_BY_FIELD)
         .map((field) => `@${field}`)
         .join(", ")})
       ON CONFLICT ("message_id") DO UPDATE SET
         ${turnColumns.map((column) => `"${column}" = "excluded"."${column}"`).join(", ")}
       WHERE ${turnColumns.map((column) => `"turn"."${column}" IS NOT "excluded"."${column}"`).join(" OR ")}`,
  );
  // A Turn without a `requestId` is its own file's: its one occurrence owns it,
  // with its own usage. Its row outlives nothing: its occurrence's delete cascades to it.
  const insertOwnFileTurns = db.prepare(
    `INSERT INTO "turn" (${turnColumns.map((column) => `"${column}"`).join(", ")})
     SELECT "id", "agent_id", "conversation_id", COALESCE("input_tokens", 0), COALESCE("output_tokens", 0),
            COALESCE("cache_creation_5m_tokens", 0), COALESCE("cache_creation_1h_tokens", 0),
            COALESCE("cache_read_tokens", 0), "model"
       FROM "message"
      WHERE "conversation_id" = ? AND "role" = 'assistant' AND "request_id" IS NULL
      ORDER BY "id"
     ON CONFLICT ("message_id") DO NOTHING`,
  );
  const updateParserVersion = db.prepare(
    `UPDATE "conversation" SET "parser_version" = ? WHERE "id" IN (SELECT "value" FROM json_each(?))`,
  );
  const selectProjectId = db.prepare(`SELECT "id" FROM "project" WHERE "path" = ?`).pluck();
  // Conversations filed directly in the log folder: `source_path` starts with
  // `@logFolderPrefix` and holds no further separator after it. The borrower's
  // own row, still the previous parse's when it is re-parsed, has no vote.
  const selectBorrowableProjectPath = db
    .prepare(
      `SELECT "project"."path" FROM "conversation" JOIN "project" ON "project"."id" = "conversation"."project_id"
        WHERE "conversation"."project_path_from_records" = 1
          AND "conversation"."session_id" <> @borrowerSessionId
          AND substr("conversation"."source_path", 1, length(@logFolderPrefix)) = @logFolderPrefix
          AND instr(substr("conversation"."source_path", length(@logFolderPrefix) + 1), @separator) = 0
        GROUP BY "project"."path"
        ORDER BY COUNT(*) DESC, "project"."path" ASC
        LIMIT 1`,
    )
    .pluck();
  const deleteProjectsWithoutConversations = db.prepare(
    `DELETE FROM "project" WHERE "id" NOT IN (SELECT "project_id" FROM "conversation")`,
  );
  // Each system prompt, tool set and sent message is interned: shared across
  // Conversations, under the hash of its canonical JSON. Two logs may spell it
  // in two key orders, and the smallest spelling is kept, so what is stored
  // never depends on which log was parsed first.
  const insertSystemPrompt = db.prepare(
    `INSERT INTO "system_prompt" ("hash", "blocks_json") VALUES (?, ?)
       ON CONFLICT ("hash") DO UPDATE SET "blocks_json" = "excluded"."blocks_json"
       WHERE "excluded"."blocks_json" < "system_prompt"."blocks_json"`,
  );
  const insertToolSet = db.prepare(
    `INSERT INTO "tool_set" ("hash", "tools_json") VALUES (?, ?)
       ON CONFLICT ("hash") DO UPDATE SET "tools_json" = "excluded"."tools_json"
       WHERE "excluded"."tools_json" < "tool_set"."tools_json"`,
  );
  // The smallest spelling wins, its pieces with it; on the same spelling, a
  // non-NULL pieces value beats NULL, then the longer, then the smaller one.
  const insertSentMessage = db.prepare(
    `INSERT INTO "sent_message" ("hash", "message_json", "injected_context_pieces_json") VALUES (?, ?, ?)
       ON CONFLICT ("hash") DO UPDATE SET
         "message_json" = "excluded"."message_json",
         "injected_context_pieces_json" = "excluded"."injected_context_pieces_json"
       WHERE "excluded"."message_json" < "sent_message"."message_json"
          OR ("excluded"."message_json" = "sent_message"."message_json"
              AND "excluded"."injected_context_pieces_json" IS NOT NULL
              AND ("sent_message"."injected_context_pieces_json" IS NULL
                   OR length("excluded"."injected_context_pieces_json") > length("sent_message"."injected_context_pieces_json")
                   OR (length("excluded"."injected_context_pieces_json") = length("sent_message"."injected_context_pieces_json")
                       AND "excluded"."injected_context_pieces_json" < "sent_message"."injected_context_pieces_json")))`,
  );
  const deleteUnreferencedSystemPrompts = db.prepare(
    `DELETE FROM "system_prompt" WHERE NOT EXISTS
       (SELECT 1 FROM "api_request" WHERE "system_prompt_hash" = "system_prompt"."hash")`,
  );
  const deleteUnreferencedToolSets = db.prepare(
    `DELETE FROM "tool_set" WHERE NOT EXISTS
       (SELECT 1 FROM "api_request" WHERE "tool_set_hash" = "tool_set"."hash")`,
  );
  const deleteUnnamedSentMessages = db.prepare(
    `DELETE FROM "sent_message" WHERE "hash" NOT IN
       (SELECT "tail_hash"."value" FROM "api_request", json_each("tail_message_hashes_json") AS "tail_hash")`,
  );
  // A Turn's API request in its own file: of several with its `request_ref`,
  // the latest in file order. The unary `+` keeps the planner off the
  // `(agent_id, position_in_file)` index, which walks the file back from its
  // end for each Turn, and on `record_id`'s.
  const updateTurnApiRequestsInFile = db.prepare(
    `UPDATE "message" SET "api_request_id" =
       (SELECT "api_request"."id" FROM "api_request"
         WHERE +"api_request"."agent_id" = "message"."agent_id" AND "api_request"."record_id" = "message"."request_ref"
         ORDER BY "api_request"."position_in_file" DESC
         LIMIT 1)
      WHERE "agent_id" = ? AND "request_ref" IS NOT NULL`,
  );
  // THE RULE for a request several files hold (log-format §9, "How they are
  // stored"): the file of the smallest Conversation `source_path`, its Main
  // thread before its Sub-agents, then by Sub-agent id; then the latest in
  // file order. Row ids never decide: they differ between a cold Refresh and
  // an incremental one.
  const updateUnlinkedTurnApiRequests = db.prepare(
    `UPDATE "message" SET "api_request_id" =
       (SELECT "api_request"."id" FROM "api_request"
          JOIN "conversation" ON "conversation"."id" = "api_request"."conversation_id"
          JOIN "agent" ON "agent"."id" = "api_request"."agent_id"
         WHERE "api_request"."record_id" = "message"."request_ref"
         ORDER BY "conversation"."source_path", "agent"."external_agent_id" NULLS FIRST,
                  "api_request"."position_in_file" DESC
         LIMIT 1)
      WHERE "api_request_id" IS NULL AND "request_ref" IS NOT NULL`,
  );

  return {
    /** Open a write transaction. */
    beginTransaction: () => void begin.run(),
    /** Commit the open transaction. */
    commitTransaction: () => void commit.run(),
    /** Every stored Conversation, as the skip decision needs it. */
    selectStoredConversations: () => selectStoredConversations.all() as StoredConversation[],
    /** Delete a Conversation; its child rows go with it by cascade. */
    deleteConversation: (conversationId: number) => void deleteConversation.run(conversationId),
    /** Every stored Agent of a Conversation. */
    selectStoredAgents: (conversationId: number) => selectStoredAgents.all(conversationId) as StoredAgent[],
    /** Delete an Agent; its Messages, Tool calls and API requests go with it by cascade. */
    deleteAgent: (agentId: number) => void deleteAgent.run(agentId),
    /** The Message row holding Agent `agentId`'s Tool call `toolUseId`, if any. */
    selectSpawningMessageId: (agentId: number, toolUseId: string) =>
      selectSpawningMessageId.get(agentId, toolUseId) as number | undefined,
    /** The stored Agents of Conversation `conversationId` holding a Message with `uuid`. */
    selectHoldingAgentIds: (uuid: string, conversationId: number) =>
      selectHoldingAgentIds.all(uuid, conversationId) as number[],
    /** Of the stored Agents `agentIds`, those holding a Tool call `toolUseId`. */
    selectToolUseHoldingAgentIds: (toolUseId: string, agentIds: number[]) =>
      selectToolUseHoldingAgentIds.all(JSON.stringify(agentIds), toolUseId) as number[],
    /**
     * Delete a Conversation's `pr_link`, `turn_duration` and `continued_in`
     * rows: what its Main thread's file gives it besides its Agent.
     */
    deletePrLinksTurnDurationsAndContinuedIn: (conversationId: number) => {
      deletePrLinks.run(conversationId);
      deleteTurnDurations.run(conversationId);
      deleteContinuedIn.run(conversationId);
    },
    /** Point Conversation `conversationId` at the Conversation it continues from, or at none. */
    updateContinuedFrom: (conversationId: number, continuedFromConversationId: number | null) =>
      void updateContinuedFrom.run(continuedFromConversationId, conversationId),
    /** Ids of the Conversations that continue from any of `conversationIds`. */
    selectContinuationIds: (conversationIds: number[]) =>
      selectContinuationIds.all(JSON.stringify(conversationIds)) as number[],
    /** Ids of the stored Conversations of `sessionIds`. */
    selectConversationIdsBySessionId: (sessionIds: string[]) =>
      selectConversationIdsBySessionId.all(JSON.stringify(sessionIds)) as number[],
    /** Conversation `conversationId` as deciding its parent needs it; undefined when it is not stored. */
    selectContinuationCandidate: (conversationId: number) =>
      selectContinuationCandidate.get(conversationId) as ContinuationCandidate | undefined,
    /** The `uuid` of Agent `agentId`'s first Message; undefined without one, null when it has none. */
    selectFirstMessageUuid: (agentId: number) => selectFirstMessageUuid.get(agentId) as string | null | undefined,
    /** The Conversations other than `excludedConversationId` that hold a Message with `uuid`, smallest `source_path` first. */
    selectOtherHolders: (uuid: string, excludedConversationId: number) =>
      selectOtherHolders.all({ uuid, excludedConversationId }) as ContinuationCandidate[],
    /** Of the other Conversations whose `continued-in` record names `sessionId`, the one with the smallest `source_path`. */
    selectNamingConversationId: (sessionId: string, conversationId: number) =>
      selectNamingConversationId.get({ sessionId, conversationId }) as number | undefined,
    /** Whether a `continued-in` record of Conversation `conversationId` names `sessionId`. */
    isSessionNamed: (conversationId: number, sessionId: string) =>
      selectIsSessionNamed.get(conversationId, sessionId) !== undefined,
    /** Whether Agent `holdingAgentId` holds a Message with the uuid of each of Agent `agentId`'s. */
    isEveryMessageHeld: (agentId: number, holdingAgentId: number) =>
      selectIsEveryMessageHeld.get({ agentId, holdingAgentId }) === 1,
    /** How many of Agent `agentId`'s Messages, from its first, Agent `holdingAgentId` holds a Message with the uuid of. */
    selectSharedLeadingRunLength: (agentId: number, holdingAgentId: number) =>
      selectSharedLeadingRunLength.get({ agentId, holdingAgentId }) as number,
    /**
     * Flag Conversation `conversationId`'s Copied Messages: copies of
     * `parentConversationId`'s, when it has a parent, and of each Agent's spawning Agent's.
     */
    updateCopiedMessages: (conversationId: number, parentConversationId: number | null) => {
      clearCopiedMessages.run(conversationId);
      updateCopiedMessages.run({ conversationId, parentConversationId });
    },
    /** The keys of the Turns identified across the logs that Agent `agentId` holds an occurrence of. */
    selectTurnKeysOfAgent: (agentId: number) => selectTurnKeysOfAgent.all(agentId) as string[],
    /** The keys of the Turns identified across the logs that Conversation `conversationId` holds an occurrence of. */
    selectTurnKeysOfConversation: (conversationId: number) =>
      selectTurnKeysOfConversation.all(conversationId) as string[],
    /** The Conversations other than `excludedConversationId` holding an occurrence of any of the Turns `turnKeys`. */
    selectTurnKeyHolderConversationIds: (turnKeys: string[], excludedConversationId: number) =>
      selectTurnKeyHolderConversationIds.all(JSON.stringify(turnKeys), excludedConversationId) as number[],
    /** Every stored occurrence of the Turn `turnKey`, in row id order. */
    selectTurnOccurrences: (turnKey: string) => selectTurnOccurrences.all(turnKey) as TurnOccurrence[],
    /** The Agent that spawned Agent `agentId`; null for a Main thread, without one, or when it is not stored. */
    selectParentAgentId: (agentId: number) => (selectParentAgentId.get(agentId) as number | null | undefined) ?? null,
    /** The Conversation that Conversation `conversationId` continues from; null without one or when it is not stored. */
    selectContinuedFromId: (conversationId: number) =>
      (selectContinuedFromId.get(conversationId) as number | null | undefined) ?? null,
    /** Write the row of a Turn identified across the logs, and delete the rows its other occurrences held. */
    writeTurn: (turnKey: string, row: TurnRow) => {
      deleteTurnsOfOtherOccurrences.run({ turnKey, ownerMessageId: row.messageId });
      upsertTurn.run(row);
    },
    /** Write a row for each Turn of Conversation `conversationId` that is its own file's and has none yet. */
    insertOwnFileTurns: (conversationId: number) => void insertOwnFileTurns.run(conversationId),
    /** Stamp `parserVersion` on each of `conversationIds`. */
    updateParserVersion: (conversationIds: number[], parserVersion: number) =>
      void updateParserVersion.run(parserVersion, JSON.stringify(conversationIds)),
    /** Id of the project stored at `projectPath`, if any. */
    selectProjectId: (projectPath: string) => selectProjectId.get(projectPath) as number | undefined,
    /**
     * The Project path most of the Conversations filed in `logFolderPath`
     * state through their own records, ties to the smallest path; undefined
     * when none of them states one. The Conversation `borrowerSessionId` is not counted.
     */
    selectBorrowableProjectPath: (logFolderPath: string, borrowerSessionId: string) =>
      selectBorrowableProjectPath.get({
        logFolderPrefix: logFolderPath + path.sep,
        separator: path.sep,
        borrowerSessionId,
      }) as string | undefined,
    /** Delete every Project no Conversation belongs to any more. */
    deleteProjectsWithoutConversations: () => void deleteProjectsWithoutConversations.run(),
    insertProject: prepareInsert(db, "project", PROJECT_COLUMN_BY_FIELD),
    insertConversation: prepareInsert(db, "conversation", CONVERSATION_COLUMN_BY_FIELD),
    /** Rewrite the stored Conversation of row id `id` in place. */
    updateConversation: prepareUpdate(db, "conversation", CONVERSATION_COLUMN_BY_FIELD),
    insertAgent: prepareInsert(db, "agent", AGENT_COLUMN_BY_FIELD),
    /** Rewrite the lineage columns of the stored Agent of row id `id` in place. */
    updateAgentLineage: prepareUpdate(db, "agent", AGENT_LINEAGE_COLUMN_BY_FIELD),
    insertMessage: prepareInsert(db, "message", MESSAGE_COLUMN_BY_FIELD),
    insertToolCall: prepareInsert(db, "tool_call", TOOL_CALL_COLUMN_BY_FIELD),
    insertPrLink: prepareInsert(db, "pr_link", PR_LINK_COLUMN_BY_FIELD),
    insertTurnDuration: prepareInsert(db, "turn_duration", TURN_DURATION_COLUMN_BY_FIELD),
    insertApiRequest: prepareInsert(db, "api_request", API_REQUEST_COLUMN_BY_FIELD),
    insertContinuedIn: prepareInsert(db, "continued_in", CONTINUED_IN_COLUMN_BY_FIELD),
    /** Link each Turn of Agent `agentId` to the API request its `requestRef` names in the same file, if any. */
    updateTurnApiRequestsInFile: (agentId: number) => void updateTurnApiRequestsInFile.run(agentId),
    /**
     * Link every Turn of the database that has a `requestRef` and no API
     * request to the one of another file that `requestRef` names, if any.
     */
    updateUnlinkedTurnApiRequests: () => void updateUnlinkedTurnApiRequests.run(),
    /** Store a system prompt under its hash, keeping the smaller spelling when one already is. */
    insertSystemPrompt: (hash: string, blocksJson: string) => void insertSystemPrompt.run(hash, blocksJson),
    /** Store a tool set under its hash, keeping the smaller spelling when one already is. */
    insertToolSet: (hash: string, toolsJson: string) => void insertToolSet.run(hash, toolsJson),
    /**
     * Store a sent message under its hash with its pieces of Injected context,
     * keeping the smaller spelling when one already is, and of one spelling the
     * pieces that rank first (see `insertSentMessage` above).
     */
    insertSentMessage: (hash: string, sentMessage: { messageJson: string; injectedContextPiecesJson: string | null }) =>
      void insertSentMessage.run(hash, sentMessage.messageJson, sentMessage.injectedContextPiecesJson),
    /** Delete every system prompt and tool set no API request references any more, and every sent message no tail names. */
    deleteUnreferencedInternedValues: () => {
      deleteUnreferencedSystemPrompts.run();
      deleteUnreferencedToolSets.run();
      deleteUnnamedSentMessages.run();
    },
  };
}
