-- An assistant Turn's thinking (log-format §6): the text of its `thinking`
-- blocks, joined in order across the lines of its message id, and the
-- `thinkingDurationMs` of those lines, summed. The text is NULL when every
-- block is empty — most are — and the duration on logs older than 2.1.287.
-- Both are NULL on user rows and on Turns without thinking.
--
-- Backfill of already-ingested conversations is handled by the PARSER_VERSION
-- bump in `src/core/refresh.ts`, not by touching rows here.
ALTER TABLE "message" ADD COLUMN "thinking_text" TEXT;
ALTER TABLE "message" ADD COLUMN "thinking_duration_ms" INTEGER;
