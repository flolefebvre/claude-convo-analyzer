-- The messages Claude Code 2.1.300+ logged API requests sent (issue #217,
-- ADR-0007, docs/conversation-log-format.md §9): each message a request's
-- `tail` names, stored once under its hash.
--
-- No backfill: `PARSER_VERSION` 9 (`src/core/refresh.ts`) re-parses every
-- Conversation once, which writes their rows.

-- CreateTable
CREATE TABLE "sent_message" (
    "hash" TEXT NOT NULL PRIMARY KEY,
    "message_json" TEXT NOT NULL
);
