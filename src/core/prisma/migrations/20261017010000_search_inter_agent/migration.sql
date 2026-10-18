-- Search indexes Inter-agent messages (issue #96). The corpus predicate of
-- `20260804000000_search_fts5` widens to
--
--     text IS NOT NULL AND (role = 'assistant' OR kind IN ('prompt', 'inter-agent'))
--
-- Task notifications stay out: machinery, not speech. The three message
-- triggers are recreated with the new predicate, identical in each, as that
-- migration requires.
--
-- The swap keeps the external-content index in sync: every row stored before
-- the `PARSER_VERSION` 3 re-parse has kind `prompt`, `tool-result` or `meta`,
-- which both predicates treat alike, so the delete trigger removes exactly
-- what the old insert trigger added.

DROP TRIGGER IF EXISTS "message_fts_insert";
DROP TRIGGER IF EXISTS "message_fts_delete";
DROP TRIGGER IF EXISTS "message_fts_update";

CREATE TRIGGER "message_fts_insert" AFTER INSERT ON "message" BEGIN
  INSERT INTO "message_fts"("rowid", "text")
    SELECT new."id", new."text"
     WHERE new."text" IS NOT NULL
       AND (new."role" = 'assistant' OR new."kind" IN ('prompt', 'inter-agent'));
END;

CREATE TRIGGER "message_fts_delete" AFTER DELETE ON "message" BEGIN
  INSERT INTO "message_fts"("message_fts", "rowid", "text")
    SELECT 'delete', old."id", old."text"
     WHERE old."text" IS NOT NULL
       AND (old."role" = 'assistant' OR old."kind" IN ('prompt', 'inter-agent'));
END;

CREATE TRIGGER "message_fts_update" AFTER UPDATE ON "message" BEGIN
  INSERT INTO "message_fts"("message_fts", "rowid", "text")
    SELECT 'delete', old."id", old."text"
     WHERE old."text" IS NOT NULL
       AND (old."role" = 'assistant' OR old."kind" IN ('prompt', 'inter-agent'));
  INSERT INTO "message_fts"("rowid", "text")
    SELECT new."id", new."text"
     WHERE new."text" IS NOT NULL
       AND (new."role" = 'assistant' OR new."kind" IN ('prompt', 'inter-agent'));
END;

-- Backfill: index the Inter-agent messages already stored. None exist on an
-- upgrade (they appear with the re-parse, through the trigger above); this
-- matters when the index is rebuilt after it, from the original migration's
-- narrower backfill.
INSERT INTO "message_fts"("rowid", "text")
  SELECT "id", "text" FROM "message"
   WHERE "text" IS NOT NULL AND "kind" = 'inter-agent';
