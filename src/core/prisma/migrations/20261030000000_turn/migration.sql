-- A Turn is one API response (issue #302, ADR-0011): `message` keeps one row
-- per occurrence, and `turn` holds one row per Turn — its owning occurrence,
-- that occurrence's Agent and Conversation, the highest usage of each bucket
-- across every occurrence, and the owner's model and timestamp (denormalized,
-- so daily spend reads no join). The Refresh's links pass
-- writes it; Cost and every total sum it. `message.request_id` keeps the
-- record's `requestId`, which makes a Turn's identity global; `agent.source_path`
-- keeps the path each Agent's file was read at, which breaks a tie between
-- holders with no lineage between them.
--
-- Backfill of already-ingested conversations is handled by the PARSER_VERSION
-- bump in `src/core/refresh.ts`, not by touching rows here.

-- Added in place, not by redefining `message` (its search triggers) or `agent`.
ALTER TABLE "message" ADD COLUMN "request_id" TEXT;
ALTER TABLE "agent" ADD COLUMN "source_path" TEXT;

-- CreateTable
CREATE TABLE "turn" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "message_id" INTEGER NOT NULL,
    "agent_id" INTEGER NOT NULL,
    "conversation_id" INTEGER NOT NULL,
    "input_tokens" INTEGER NOT NULL,
    "output_tokens" INTEGER NOT NULL,
    "cache_creation_5m_tokens" INTEGER NOT NULL,
    "cache_creation_1h_tokens" INTEGER NOT NULL,
    "cache_read_tokens" INTEGER NOT NULL,
    "model" TEXT,
    "timestamp" BIGINT,
    CONSTRAINT "turn_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "message" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "turn_agent_id_fkey" FOREIGN KEY ("agent_id") REFERENCES "agent" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "turn_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversation" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "turn_message_id_key" ON "turn"("message_id");

-- CreateIndex
CREATE INDEX "turn_agent_id_idx" ON "turn"("agent_id");

-- CreateIndex
CREATE INDEX "turn_conversation_id_idx" ON "turn"("conversation_id");
