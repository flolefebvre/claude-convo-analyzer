-- The API requests Claude Code 2.1.300+ logs (issue #216, ADR-0007,
-- docs/conversation-log-format.md §9): one row per `api-request` record, its
-- system prompt and tool set each stored once under their hash.
--
-- No backfill: `PARSER_VERSION` 8 (`src/core/refresh.ts`) re-parses every
-- Conversation once, which writes their rows.

-- CreateTable
CREATE TABLE "logged_api_request" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "conversation_id" INTEGER NOT NULL,
    "agent_id" INTEGER NOT NULL,
    "message_id" INTEGER,
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
    CONSTRAINT "logged_api_request_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversation" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "logged_api_request_agent_id_fkey" FOREIGN KEY ("agent_id") REFERENCES "agent" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "logged_api_request_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "message" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "logged_api_request_system_prompt_hash_fkey" FOREIGN KEY ("system_prompt_hash") REFERENCES "system_prompt" ("hash") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "logged_api_request_tool_set_hash_fkey" FOREIGN KEY ("tool_set_hash") REFERENCES "tool_set" ("hash") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "system_prompt" (
    "hash" TEXT NOT NULL PRIMARY KEY,
    "blocks_json" TEXT NOT NULL
);

-- CreateTable
CREATE TABLE "tool_set" (
    "hash" TEXT NOT NULL PRIMARY KEY,
    "tools_json" TEXT NOT NULL
);

-- CreateIndex
CREATE INDEX "logged_api_request_conversation_id_idx" ON "logged_api_request"("conversation_id");

-- CreateIndex
CREATE INDEX "logged_api_request_message_id_idx" ON "logged_api_request"("message_id");

-- CreateIndex
CREATE INDEX "logged_api_request_agent_id_position_in_file_idx" ON "logged_api_request"("agent_id", "position_in_file");

-- CreateIndex
CREATE INDEX "logged_api_request_system_prompt_hash_idx" ON "logged_api_request"("system_prompt_hash");

-- CreateIndex
CREATE INDEX "logged_api_request_tool_set_hash_idx" ON "logged_api_request"("tool_set_hash");
