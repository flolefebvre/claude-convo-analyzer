-- A continuation copies its parent's records (issue #284, log-format §10):
-- `continued_in` keeps each `continued-in` record a Main-thread file holds,
-- the session it names, so a Refresh links a continuation to its parent from
-- the database alone; `message.is_copied` flags the Messages a continuation
-- copied; `conversation.continued_from_conversation_id` is indexed, so a
-- Refresh finds a rewritten Conversation's continuations without a scan.
--
-- Backfill of already-ingested conversations is handled by the PARSER_VERSION
-- bump in `src/core/refresh.ts`, not by touching rows here.

-- CreateTable
CREATE TABLE "continued_in" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "conversation_id" INTEGER NOT NULL,
    "session_id" TEXT NOT NULL,
    CONSTRAINT "continued_in_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversation" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "continued_in_conversation_id_idx" ON "continued_in"("conversation_id");

-- CreateIndex
CREATE INDEX "continued_in_session_id_idx" ON "continued_in"("session_id");

-- CreateIndex
CREATE INDEX "conversation_continued_from_conversation_id_idx" ON "conversation"("continued_from_conversation_id");

-- Added in place, not by redefining `message`: that would drop the search
-- triggers on it. An UPDATE of this column leaves them alone: the search
-- index's update trigger fires on `id`, `text`, `role` and `kind` only
-- (`message_fts_update`, 20261027000000_turn_api_request).
ALTER TABLE "message" ADD COLUMN "is_copied" BOOLEAN NOT NULL DEFAULT false;
