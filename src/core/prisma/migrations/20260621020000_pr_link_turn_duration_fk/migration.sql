-- Add the missing conversation foreign key (ON DELETE CASCADE) to `pr_link` and
-- `turn_duration`. The initial migration created these two side tables WITHOUT a
-- back-relation, so deleting a conversation left orphaned pr_link/turn_duration
-- rows. SQLite can't ALTER an existing FK, so each table is rebuilt (Prisma's
-- standard "redefine table" pattern: create new → copy → drop → rename → index).
--
-- NOTE: this migration is applied inside a transaction by `applyMigrations`. The
-- rebuilds only touch CHILD tables (no parent row changes), so FK checks pass.

-- RedefineTable pr_link
CREATE TABLE "new_pr_link" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "conversation_id" INTEGER NOT NULL,
    "pr_number" INTEGER,
    "pr_url" TEXT NOT NULL,
    "pr_repository" TEXT,
    CONSTRAINT "pr_link_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversation" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_pr_link" ("id", "conversation_id", "pr_number", "pr_url", "pr_repository")
SELECT "id", "conversation_id", "pr_number", "pr_url", "pr_repository" FROM "pr_link";
DROP TABLE "pr_link";
ALTER TABLE "new_pr_link" RENAME TO "pr_link";
CREATE INDEX "pr_link_conversation_id_idx" ON "pr_link"("conversation_id");

-- RedefineTable turn_duration
CREATE TABLE "new_turn_duration" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "conversation_id" INTEGER NOT NULL,
    "duration_ms" BIGINT NOT NULL,
    "message_count" INTEGER NOT NULL,
    CONSTRAINT "turn_duration_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversation" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_turn_duration" ("id", "conversation_id", "duration_ms", "message_count")
SELECT "id", "conversation_id", "duration_ms", "message_count" FROM "turn_duration";
DROP TABLE "turn_duration";
ALTER TABLE "new_turn_duration" RENAME TO "turn_duration";
CREATE INDEX "turn_duration_conversation_id_idx" ON "turn_duration"("conversation_id");
