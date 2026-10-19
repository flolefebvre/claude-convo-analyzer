-- Side requests (issue #131): every API request gets the `kind` the Refresh
-- classifies it as, replacing `is_failed_attempt` (now `kind = 'failed-attempt'`),
-- an `other_kind_label` for the `other` kind, and its response's usage — the
-- five token buckets as `message` names them, and the model.
--
-- The backfill below only keeps already-ingested rows readable: a joined
-- failed attempt stays one, a joined row is a Turn's, every other row reads
-- as `other` with no usage. The PARSER_VERSION bump in `src/core/refresh.ts`
-- re-parses every Conversation, which classifies and fills each row properly.
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_api_request" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "conversation_id" INTEGER NOT NULL,
    "message_id" INTEGER,
    "agent_id" INTEGER,
    "kind" TEXT NOT NULL,
    "other_kind_label" TEXT,
    "request_id" TEXT,
    "response_message_id" TEXT,
    "external_agent_id" TEXT,
    "method" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "status" INTEGER NOT NULL,
    "arrived_at" BIGINT NOT NULL,
    "first_byte_at" BIGINT,
    "ended_at" BIGINT NOT NULL,
    "proxy_error" TEXT,
    "is_client_aborted" BOOLEAN NOT NULL DEFAULT false,
    "error_message" TEXT,
    "input_tokens" INTEGER,
    "output_tokens" INTEGER,
    "cache_creation_5m_tokens" INTEGER,
    "cache_creation_1h_tokens" INTEGER,
    "cache_read_tokens" INTEGER,
    "model" TEXT,
    CONSTRAINT "api_request_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversation" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "api_request_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "message" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "api_request_agent_id_fkey" FOREIGN KEY ("agent_id") REFERENCES "agent" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_api_request" ("agent_id", "arrived_at", "conversation_id", "ended_at", "error_message", "external_agent_id", "first_byte_at", "id", "is_client_aborted", "kind", "message_id", "method", "path", "proxy_error", "request_id", "response_message_id", "status")
SELECT "agent_id", "arrived_at", "conversation_id", "ended_at", "error_message", "external_agent_id", "first_byte_at", "id", "is_client_aborted",
    CASE WHEN "is_failed_attempt" THEN 'failed-attempt' WHEN "message_id" IS NOT NULL THEN 'turn' ELSE 'other' END,
    "message_id", "method", "path", "proxy_error", "request_id", "response_message_id", "status"
FROM "api_request";
DROP TABLE "api_request";
ALTER TABLE "new_api_request" RENAME TO "api_request";
CREATE INDEX "api_request_conversation_id_idx" ON "api_request"("conversation_id");
CREATE INDEX "api_request_message_id_idx" ON "api_request"("message_id");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
