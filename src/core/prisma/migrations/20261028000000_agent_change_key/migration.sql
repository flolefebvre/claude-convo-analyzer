-- Each Agent carries its own log file's change key (issue #141, ADR-0010): a
-- changed Conversation re-parses and rewrites only the Agents whose file moved.
-- NULL means no key recorded; rows written before this column are rewritten
-- once by the PARSER_VERSION bump in `src/core/refresh.ts`, not here.

-- AlterTable
ALTER TABLE "agent" ADD COLUMN "source_mtime" BIGINT;
ALTER TABLE "agent" ADD COLUMN "source_size" BIGINT;
