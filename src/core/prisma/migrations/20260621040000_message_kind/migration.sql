-- Classify each `user` record for the Transcript view: only genuine human
-- prompts render as user messages; tool-result carriers and machine-injected
-- `isMeta` records (skill instructions, command output, system reminders) are
-- excluded. `kind` is derived at parse time and is one of
-- `prompt` | `tool-result` | `meta`; it is NULL on assistant rows (no
-- meaningful kind). No index: `kind` is a low-cardinality categorical filter
-- always queried alongside the already-indexed `agent_id`/`conversation_id`.
ALTER TABLE "message" ADD COLUMN "kind" TEXT;

-- Force a full re-parse of EVERY conversation on the next refresh so existing
-- rows are backfilled with `kind`. `refresh()` skips a conversation whose
-- stored `source_mtime`/`source_size` still match the file; setting the stored
-- mtime to a sentinel it can never equal invalidates that skip. (There is no
-- parse-version field; this is the chosen, owner-approved re-parse mechanism.)
UPDATE "conversation" SET "source_mtime" = -1;
