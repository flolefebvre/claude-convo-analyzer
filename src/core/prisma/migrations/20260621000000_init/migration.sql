-- CreateTable
CREATE TABLE "project" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "path" TEXT NOT NULL,
    "folder_name" TEXT NOT NULL
);

-- CreateTable
CREATE TABLE "conversation" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "session_id" TEXT NOT NULL,
    "project_id" INTEGER NOT NULL,
    "title" TEXT,
    "git_branch" TEXT,
    "cc_version" TEXT,
    "source_path" TEXT NOT NULL,
    "source_mtime" BIGINT NOT NULL,
    "source_size" BIGINT NOT NULL,
    "continued_from_conversation_id" INTEGER,
    CONSTRAINT "conversation_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "project" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "conversation_continued_from_conversation_id_fkey" FOREIGN KEY ("continued_from_conversation_id") REFERENCES "conversation" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "agent" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "conversation_id" INTEGER NOT NULL,
    "parent_agent_id" INTEGER,
    "spawned_by_message_id" INTEGER,
    "agent_type" TEXT,
    "resolved_model" TEXT,
    "duration_ms" BIGINT,
    "tool_call_count" INTEGER,
    CONSTRAINT "agent_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversation" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "agent_parent_agent_id_fkey" FOREIGN KEY ("parent_agent_id") REFERENCES "agent" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "agent_spawned_by_message_id_fkey" FOREIGN KEY ("spawned_by_message_id") REFERENCES "message" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "message" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "conversation_id" INTEGER NOT NULL,
    "agent_id" INTEGER NOT NULL,
    "message_id" TEXT,
    "role" TEXT NOT NULL,
    "text" TEXT,
    "input_tokens" INTEGER,
    "output_tokens" INTEGER,
    "cache_creation_5m_tokens" INTEGER,
    "cache_creation_1h_tokens" INTEGER,
    "cache_read_tokens" INTEGER,
    "model" TEXT,
    "attribution_skill" TEXT,
    "attribution_agent" TEXT,
    "attribution_plugin" TEXT,
    "attribution_mcp_server" TEXT,
    "permission_mode" TEXT,
    "is_api_error" BOOLEAN NOT NULL DEFAULT false,
    "api_error_message" TEXT,
    "timestamp" BIGINT,
    CONSTRAINT "message_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversation" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "message_agent_id_fkey" FOREIGN KEY ("agent_id") REFERENCES "agent" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "tool_call" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "message_id" INTEGER NOT NULL,
    "agent_id" INTEGER NOT NULL,
    "tool_use_id" TEXT,
    "name" TEXT NOT NULL,
    "input_json" TEXT NOT NULL,
    "result_text" TEXT,
    "result_truncated" BOOLEAN NOT NULL DEFAULT false,
    "result_char_size" INTEGER,
    "is_error" BOOLEAN NOT NULL DEFAULT false,
    CONSTRAINT "tool_call_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "message" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "tool_call_agent_id_fkey" FOREIGN KEY ("agent_id") REFERENCES "agent" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "pr_link" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "conversation_id" INTEGER NOT NULL,
    "pr_number" INTEGER,
    "pr_url" TEXT NOT NULL,
    "pr_repository" TEXT
);

-- CreateTable
CREATE TABLE "turn_duration" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "conversation_id" INTEGER NOT NULL,
    "duration_ms" BIGINT NOT NULL,
    "message_count" INTEGER NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "project_path_key" ON "project"("path");

-- CreateIndex
CREATE UNIQUE INDEX "conversation_session_id_key" ON "conversation"("session_id");

-- CreateIndex
CREATE INDEX "conversation_project_id_idx" ON "conversation"("project_id");

-- CreateIndex
CREATE INDEX "agent_conversation_id_idx" ON "agent"("conversation_id");

-- CreateIndex
CREATE INDEX "agent_parent_agent_id_idx" ON "agent"("parent_agent_id");

-- CreateIndex
CREATE INDEX "message_conversation_id_idx" ON "message"("conversation_id");

-- CreateIndex
CREATE INDEX "message_agent_id_idx" ON "message"("agent_id");

-- CreateIndex
CREATE INDEX "message_message_id_idx" ON "message"("message_id");

-- CreateIndex
CREATE INDEX "tool_call_message_id_idx" ON "tool_call"("message_id");

-- CreateIndex
CREATE INDEX "tool_call_agent_id_idx" ON "tool_call"("agent_id");

-- CreateIndex
CREATE INDEX "pr_link_conversation_id_idx" ON "pr_link"("conversation_id");

-- CreateIndex
CREATE INDEX "turn_duration_conversation_id_idx" ON "turn_duration"("conversation_id");

