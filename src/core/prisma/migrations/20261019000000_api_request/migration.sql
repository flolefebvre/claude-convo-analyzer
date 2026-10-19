-- One row per API request a Recording holds for a Conversation's session
-- (issue #128, ADR-0006), joined to its Turn's message and agent when one
-- matches. Nothing of the request body is stored.
--
-- No backfill: a Conversation with a Recording now has a different composite
-- change key (the Recording file is folded into it, `src/core/refresh.ts`), so
-- the next Refresh re-parses it and writes its rows.
CREATE TABLE "api_request" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "conversation_id" INTEGER NOT NULL,
    "message_id" INTEGER,
    "agent_id" INTEGER,
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
    CONSTRAINT "api_request_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversation" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "api_request_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "message" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "api_request_agent_id_fkey" FOREIGN KEY ("agent_id") REFERENCES "agent" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX "api_request_conversation_id_idx" ON "api_request"("conversation_id");

CREATE INDEX "api_request_message_id_idx" ON "api_request"("message_id");
