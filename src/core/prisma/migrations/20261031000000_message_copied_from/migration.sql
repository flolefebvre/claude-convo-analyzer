-- A Copied Message comes from ownership (issue #303, ADR-0011): an occurrence
-- of a Message in an Agent that does not own it. `message.copied_from_message_id`
-- names the owning occurrence's row, NULL on the owner, and replaces the
-- `is_copied` flag the links pass derived from two matching rules. It is
-- indexed: a delete of an owner sets its copies' column to NULL, which SQLite
-- would otherwise find by scanning `message` once per deleted row.
--
-- Backfill of already-ingested conversations is handled by the PARSER_VERSION
-- bump in `src/core/refresh.ts`, not by touching rows here.

-- Changed in place, not by redefining `message`: that would drop the search
-- triggers on it, none of which reads either column.
ALTER TABLE "message" DROP COLUMN "is_copied";
ALTER TABLE "message" ADD COLUMN "copied_from_message_id" INTEGER REFERENCES "message" ("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateIndex
CREATE INDEX "message_copied_from_message_id_idx" ON "message"("copied_from_message_id");
