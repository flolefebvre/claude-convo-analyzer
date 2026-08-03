-- Full-text search across conversations (issue #45).
--
-- Prisma cannot model FTS5 virtual tables, so the index and its maintenance are
-- raw SQL here; `schema.prisma` stays unaware of them. Two indexes, both
-- EXTERNAL CONTENT (`content=`/`content_rowid=`) so the searchable text is NOT
-- stored a second time — FTS5 reads it back from `message` / `conversation`
-- when it needs `snippet()`.
--
-- THE CORPUS — "what was said", not machinery:
--
--     text IS NOT NULL AND (role = 'assistant' OR kind = 'prompt')
--
-- i.e. human prompts and assistant text. Meta records, tool-result carriers and
-- tool inputs/results are never indexed (tool text lives in `tool_call`, which
-- has no index at all). That predicate is THE invariant of this file: it appears
-- once in the backfill and once per trigger below, and it must be identical in
-- every one of them — an insert that indexes a row the delete leaves behind (or
-- vice versa) desyncs an external-content index. `search-index.test.ts` pins the
-- set of indexed rows against exactly this predicate after every refresh path.
--
-- MAINTENANCE — triggers, not application code. `refresh()` rewrites a changed
-- conversation by DELETING it (the FK cascade takes its messages) and
-- re-inserting; SQLite fires row triggers for cascade deletes, so the index
-- follows every write path, including a `PARSER_VERSION` re-parse, without
-- refresh.ts knowing the index exists.
--
-- Each trigger applies the predicate as an `INSERT ... SELECT ... WHERE` rather
-- than a `WHEN` clause: the UPDATE case then does its delete-then-insert inside
-- ONE trigger body, whose statement order is guaranteed (two separate triggers
-- would fire in an unspecified order and could insert before deleting).

-- ── Message text ────────────────────────────────────────────────────────────
CREATE VIRTUAL TABLE "message_fts" USING fts5(
  "text",
  content='message',
  content_rowid='id',
  tokenize='unicode61 remove_diacritics 2'
);

CREATE TRIGGER "message_fts_insert" AFTER INSERT ON "message" BEGIN
  INSERT INTO "message_fts"("rowid", "text")
    SELECT new."id", new."text"
     WHERE new."text" IS NOT NULL
       AND (new."role" = 'assistant' OR new."kind" = 'prompt');
END;

CREATE TRIGGER "message_fts_delete" AFTER DELETE ON "message" BEGIN
  INSERT INTO "message_fts"("message_fts", "rowid", "text")
    SELECT 'delete', old."id", old."text"
     WHERE old."text" IS NOT NULL
       AND (old."role" = 'assistant' OR old."kind" = 'prompt');
END;

CREATE TRIGGER "message_fts_update" AFTER UPDATE ON "message" BEGIN
  INSERT INTO "message_fts"("message_fts", "rowid", "text")
    SELECT 'delete', old."id", old."text"
     WHERE old."text" IS NOT NULL
       AND (old."role" = 'assistant' OR old."kind" = 'prompt');
  INSERT INTO "message_fts"("rowid", "text")
    SELECT new."id", new."text"
     WHERE new."text" IS NOT NULL
       AND (new."role" = 'assistant' OR new."kind" = 'prompt');
END;

-- ── Conversation titles ─────────────────────────────────────────────────────
CREATE VIRTUAL TABLE "conversation_title_fts" USING fts5(
  "title",
  content='conversation',
  content_rowid='id',
  tokenize='unicode61 remove_diacritics 2'
);

CREATE TRIGGER "conversation_title_fts_insert" AFTER INSERT ON "conversation" BEGIN
  INSERT INTO "conversation_title_fts"("rowid", "title")
    SELECT new."id", new."title" WHERE new."title" IS NOT NULL;
END;

CREATE TRIGGER "conversation_title_fts_delete" AFTER DELETE ON "conversation" BEGIN
  INSERT INTO "conversation_title_fts"("conversation_title_fts", "rowid", "title")
    SELECT 'delete', old."id", old."title" WHERE old."title" IS NOT NULL;
END;

-- The conversation row IS updated after insert (`parser_version` stamping,
-- continued-from linking), so this trigger runs on rows whose title did not
-- change — a delete-then-insert of identical values, which is a no-op for the
-- index and keeps the code free of a "did the title change" special case.
CREATE TRIGGER "conversation_title_fts_update" AFTER UPDATE ON "conversation" BEGIN
  INSERT INTO "conversation_title_fts"("conversation_title_fts", "rowid", "title")
    SELECT 'delete', old."id", old."title" WHERE old."title" IS NOT NULL;
  INSERT INTO "conversation_title_fts"("rowid", "title")
    SELECT new."id", new."title" WHERE new."title" IS NOT NULL;
END;

-- ── Backfill ────────────────────────────────────────────────────────────────
-- Existing databases become searchable the moment this migration applies — no
-- `PARSER_VERSION` bump, so nobody pays for a full re-parse to get search. The
-- predicate below is the one documented at the top of this file, verbatim.
INSERT INTO "message_fts"("rowid", "text")
  SELECT "id", "text" FROM "message"
   WHERE "text" IS NOT NULL AND ("role" = 'assistant' OR "kind" = 'prompt');

INSERT INTO "conversation_title_fts"("rowid", "title")
  SELECT "id", "title" FROM "conversation" WHERE "title" IS NOT NULL;
