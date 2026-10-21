-- A Turn names its API request, rather than the request naming its Turn
-- (issue #226): one request is answered by its own file's Turn and by that
-- Turn's copies in every resumed or forked session's file, so the link is many
-- Turns to one request and lives on `message`. `message.request_ref` keeps the
-- assistant record's `requestRef`, so the Refresh can link a Turn to a request
-- of another file from the database alone; `api_request.message_id` goes.
--
-- Backfill of already-ingested conversations is handled by the PARSER_VERSION
-- bump in `src/core/refresh.ts`, not by touching rows here.

-- RedefineTables: `api_request` without `message_id`, indexed on `record_id`.
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_api_request" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "conversation_id" INTEGER NOT NULL,
    "agent_id" INTEGER NOT NULL,
    "failed_attempt_of_message_id" INTEGER,
    "record_id" TEXT NOT NULL,
    "base_record_id" TEXT,
    "kept_message_count" INTEGER NOT NULL,
    "tail_message_hashes_json" TEXT NOT NULL,
    "parameters_json" TEXT NOT NULL,
    "cache_breakpoints_json" TEXT NOT NULL,
    "query_source" TEXT,
    "request_digest" TEXT,
    "sent_at" BIGINT,
    "position_in_file" INTEGER NOT NULL,
    "system_prompt_hash" TEXT,
    "tool_set_hash" TEXT,
    CONSTRAINT "api_request_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversation" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "api_request_agent_id_fkey" FOREIGN KEY ("agent_id") REFERENCES "agent" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "api_request_failed_attempt_of_message_id_fkey" FOREIGN KEY ("failed_attempt_of_message_id") REFERENCES "message" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "api_request_system_prompt_hash_fkey" FOREIGN KEY ("system_prompt_hash") REFERENCES "system_prompt" ("hash") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "api_request_tool_set_hash_fkey" FOREIGN KEY ("tool_set_hash") REFERENCES "tool_set" ("hash") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_api_request" ("agent_id", "base_record_id", "cache_breakpoints_json", "conversation_id", "failed_attempt_of_message_id", "id", "kept_message_count", "parameters_json", "position_in_file", "query_source", "record_id", "request_digest", "sent_at", "system_prompt_hash", "tail_message_hashes_json", "tool_set_hash") SELECT "agent_id", "base_record_id", "cache_breakpoints_json", "conversation_id", "failed_attempt_of_message_id", "id", "kept_message_count", "parameters_json", "position_in_file", "query_source", "record_id", "request_digest", "sent_at", "system_prompt_hash", "tail_message_hashes_json", "tool_set_hash" FROM "api_request";
DROP TABLE "api_request";
ALTER TABLE "new_api_request" RENAME TO "api_request";
CREATE INDEX "api_request_conversation_id_idx" ON "api_request"("conversation_id");
CREATE INDEX "api_request_record_id_idx" ON "api_request"("record_id");
CREATE INDEX "api_request_failed_attempt_of_message_id_idx" ON "api_request"("failed_attempt_of_message_id");
CREATE INDEX "api_request_agent_id_position_in_file_idx" ON "api_request"("agent_id", "position_in_file");
CREATE INDEX "api_request_system_prompt_hash_idx" ON "api_request"("system_prompt_hash");
CREATE INDEX "api_request_tool_set_hash_idx" ON "api_request"("tool_set_hash");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- Added in place, not by redefining `message`: that would drop the search
-- triggers on it (20261017010000_search_inter_agent).
ALTER TABLE "message" ADD COLUMN "request_ref" TEXT;
ALTER TABLE "message" ADD COLUMN "api_request_id" INTEGER REFERENCES "api_request" ("id") ON DELETE SET NULL ON UPDATE CASCADE;
-- The Refresh's scan for the Turns with a `request_ref` and no `api_request_id`.
CREATE INDEX "message_api_request_id_request_ref_idx" ON "message"("api_request_id", "request_ref");

-- The search index reads four `message` columns: `id` (its `content_rowid`),
-- `text` (its one indexed column) and `role` and `kind` (its corpus predicate,
-- 20260804000000_search_fts5 and 20261017010000_search_inter_agent). It is
-- re-indexed on an UPDATE of those only, so one setting a Turn's
-- `api_request_id` leaves it alone.
DROP TRIGGER IF EXISTS "message_fts_update";
CREATE TRIGGER "message_fts_update" AFTER UPDATE OF "id", "text", "role", "kind" ON "message" BEGIN
  INSERT INTO "message_fts"("message_fts", "rowid", "text")
    SELECT 'delete', old."id", old."text"
     WHERE old."text" IS NOT NULL
       AND (old."role" = 'assistant' OR old."kind" IN ('prompt', 'inter-agent'));
  INSERT INTO "message_fts"("rowid", "text")
    SELECT new."id", new."text"
     WHERE new."text" IS NOT NULL
       AND (new."role" = 'assistant' OR new."kind" IN ('prompt', 'inter-agent'));
END;
