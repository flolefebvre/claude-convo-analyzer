-- The pieces of Injected context a sent message holds (issue #222,
-- docs/conversation-log-format.md §9): each one's content block, its span
-- there and its kind, the attachment type of the log's `attachment` record
-- whose rendered text it is. NULL without any.
--
-- Backfill of already-ingested conversations is handled by the PARSER_VERSION
-- bump in `src/core/refresh.ts`, not by touching rows here.
ALTER TABLE "sent_message" ADD COLUMN "injected_context_pieces_json" TEXT;
