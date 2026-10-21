-- With `api_request` dropped (the migration before this one), the logs' table
-- is the only one of API requests left, and takes the plain name (issue #219):
-- `logged_api_request` becomes `api_request`, its constraints and indexes
-- renamed with it. Its rows are kept as they are.

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "api_request" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "conversation_id" INTEGER NOT NULL,
    "agent_id" INTEGER NOT NULL,
    "message_id" INTEGER,
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
    CONSTRAINT "api_request_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "message" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "api_request_failed_attempt_of_message_id_fkey" FOREIGN KEY ("failed_attempt_of_message_id") REFERENCES "message" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "api_request_system_prompt_hash_fkey" FOREIGN KEY ("system_prompt_hash") REFERENCES "system_prompt" ("hash") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "api_request_tool_set_hash_fkey" FOREIGN KEY ("tool_set_hash") REFERENCES "tool_set" ("hash") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "api_request" ("agent_id", "base_record_id", "cache_breakpoints_json", "conversation_id", "failed_attempt_of_message_id", "id", "kept_message_count", "message_id", "parameters_json", "position_in_file", "query_source", "record_id", "request_digest", "sent_at", "system_prompt_hash", "tail_message_hashes_json", "tool_set_hash") SELECT "agent_id", "base_record_id", "cache_breakpoints_json", "conversation_id", "failed_attempt_of_message_id", "id", "kept_message_count", "message_id", "parameters_json", "position_in_file", "query_source", "record_id", "request_digest", "sent_at", "system_prompt_hash", "tail_message_hashes_json", "tool_set_hash" FROM "logged_api_request";
DROP TABLE "logged_api_request";
CREATE INDEX "api_request_conversation_id_idx" ON "api_request"("conversation_id");
CREATE INDEX "api_request_message_id_idx" ON "api_request"("message_id");
CREATE INDEX "api_request_failed_attempt_of_message_id_idx" ON "api_request"("failed_attempt_of_message_id");
CREATE INDEX "api_request_agent_id_position_in_file_idx" ON "api_request"("agent_id", "position_in_file");
CREATE INDEX "api_request_system_prompt_hash_idx" ON "api_request"("system_prompt_hash");
CREATE INDEX "api_request_tool_set_hash_idx" ON "api_request"("tool_set_hash");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
