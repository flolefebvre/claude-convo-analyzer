-- An API request's tail is stored one row per message hash (issue #273):
-- `api_request_tail_message` replaces `api_request.tail_message_hashes_json`,
-- so the Refresh finds whether any tail still names a sent message through
-- the index on `message_hash` rather than by expanding every tail.
--
-- The rows are backfilled from the JSON column, which held strings only
-- (`parse.ts` filters the rest out), each at its index: the transformation is
-- lossless, so no PARSER_VERSION bump re-parses what is stored.

-- CreateTable
CREATE TABLE "api_request_tail_message" (
    "api_request_id" INTEGER NOT NULL,
    "position" INTEGER NOT NULL,
    "message_hash" TEXT NOT NULL,

    PRIMARY KEY ("api_request_id", "position"),
    CONSTRAINT "api_request_tail_message_api_request_id_fkey" FOREIGN KEY ("api_request_id") REFERENCES "api_request" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "api_request_tail_message_message_hash_idx" ON "api_request_tail_message"("message_hash");

INSERT INTO "api_request_tail_message" ("api_request_id", "position", "message_hash")
SELECT "api_request"."id", "tail_message"."key", "tail_message"."value"
  FROM "api_request", json_each("api_request"."tail_message_hashes_json") AS "tail_message";

-- Dropped in place, not by redefining `api_request`: its row ids, indexes and
-- foreign keys stay as they are, and so do the Turns and tail rows naming it.
ALTER TABLE "api_request" DROP COLUMN "tail_message_hashes_json";
