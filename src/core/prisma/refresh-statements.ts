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

const AGENT_COLUMN_BY_FIELD = {
  conversationId: "conversation_id",
  parentAgentId: "parent_agent_id",
  externalAgentId: "external_agent_id",
  spawnedByMessageId: "spawned_by_message_id",
  agentType: "agent_type",
  resolvedModel: "resolved_model",
} as const;

const MESSAGE_COLUMN_BY_FIELD = {
  conversationId: "conversation_id",
  agentId: "agent_id",
  messageId: "message_id",
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
  attributionSkill: "attribution_skill",
  attributionAgent: "attribution_agent",
  attributionPlugin: "attribution_plugin",
  attributionMcpServer: "attribution_mcp_server",
  permissionMode: "permission_mode",
  isApiError: "is_api_error",
  apiErrorMessage: "api_error_message",
  timestamp: "timestamp",
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

const API_REQUEST_COLUMN_BY_FIELD = {
  conversationId: "conversation_id",
  messageId: "message_id",
  agentId: "agent_id",
  isFailedAttempt: "is_failed_attempt",
  requestId: "request_id",
  responseMessageId: "response_message_id",
  externalAgentId: "external_agent_id",
  method: "method",
  path: "path",
  status: "status",
  arrivedAt: "arrived_at",
  firstByteAt: "first_byte_at",
  endedAt: "ended_at",
  proxyError: "proxy_error",
  isClientAborted: "is_client_aborted",
  errorMessage: "error_message",
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

/** What the skip/changed/delete decision needs of a stored Conversation. */
export type StoredConversation = {
  id: number;
  sessionId: string;
  sourcePath: string;
  sourceMtime: number;
  sourceSize: number;
  parserVersion: number;
};

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
  const selectContinuingConversationIds = db
    .prepare(`SELECT "id" FROM "conversation" WHERE "continued_from_conversation_id" = ?`)
    .pluck();
  // The ids go in as one JSON array, so any number of them binds to one parameter.
  const updateContinuedFrom = db.prepare(
    `UPDATE "conversation" SET "continued_from_conversation_id" = ? WHERE "id" IN (SELECT "value" FROM json_each(?))`,
  );
  const updateParserVersion = db.prepare(
    `UPDATE "conversation" SET "parser_version" = ? WHERE "id" IN (SELECT "value" FROM json_each(?))`,
  );
  const selectProjectId = db.prepare(`SELECT "id" FROM "project" WHERE "path" = ?`).pluck();
  // Conversations filed directly in the log folder: `source_path` starts with
  // `@logFolderPrefix` and holds no further separator after it.
  const selectBorrowableProjectPath = db
    .prepare(
      `SELECT "project"."path" FROM "conversation" JOIN "project" ON "project"."id" = "conversation"."project_id"
        WHERE "conversation"."project_path_from_records" = 1
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
  // `uuid` is not unique: the first message stored with it decides.
  const selectMessageOwner = db.prepare(
    `SELECT "id", "session_id" AS "sessionId" FROM "conversation"
      WHERE "id" = (SELECT "conversation_id" FROM "message" WHERE "uuid" = ? LIMIT 1)`,
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
    /** Ids of the Conversations that continue from `conversationId`. */
    selectContinuingConversationIds: (conversationId: number) =>
      selectContinuingConversationIds.all(conversationId) as number[],
    /** Point each of `conversationIds` at the Conversation they continue from. */
    updateContinuedFrom: (conversationIds: number[], continuedFromConversationId: number) =>
      void updateContinuedFrom.run(continuedFromConversationId, JSON.stringify(conversationIds)),
    /** Stamp `parserVersion` on each of `conversationIds`. */
    updateParserVersion: (conversationIds: number[], parserVersion: number) =>
      void updateParserVersion.run(parserVersion, JSON.stringify(conversationIds)),
    /** Id of the project stored at `projectPath`, if any. */
    selectProjectId: (projectPath: string) => selectProjectId.get(projectPath) as number | undefined,
    /**
     * The Project path most of the Conversations filed in `logFolderPath`
     * state through their own records, ties to the smallest path; undefined
     * when none of them states one.
     */
    selectBorrowableProjectPath: (logFolderPath: string) =>
      selectBorrowableProjectPath.get({ logFolderPrefix: logFolderPath + path.sep, separator: path.sep }) as
        string | undefined,
    /** Delete every Project no Conversation belongs to any more. */
    deleteProjectsWithoutConversations: () => void deleteProjectsWithoutConversations.run(),
    /** The Conversation owning the first message stored with `uuid`, if any. */
    selectMessageOwner: (uuid: string) => selectMessageOwner.get(uuid) as { id: number; sessionId: string } | undefined,
    insertProject: prepareInsert(db, "project", PROJECT_COLUMN_BY_FIELD),
    insertConversation: prepareInsert(db, "conversation", CONVERSATION_COLUMN_BY_FIELD),
    insertAgent: prepareInsert(db, "agent", AGENT_COLUMN_BY_FIELD),
    insertMessage: prepareInsert(db, "message", MESSAGE_COLUMN_BY_FIELD),
    insertToolCall: prepareInsert(db, "tool_call", TOOL_CALL_COLUMN_BY_FIELD),
    insertPrLink: prepareInsert(db, "pr_link", PR_LINK_COLUMN_BY_FIELD),
    insertTurnDuration: prepareInsert(db, "turn_duration", TURN_DURATION_COLUMN_BY_FIELD),
    insertApiRequest: prepareInsert(db, "api_request", API_REQUEST_COLUMN_BY_FIELD),
  };
}
