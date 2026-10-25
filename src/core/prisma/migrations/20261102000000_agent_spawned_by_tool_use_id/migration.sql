-- A Sub-agent's spawning call is stored as the links pass decides it (issue
-- #312): `spawned_by_tool_use_id`, beside `spawned_by_message_id`, so a reader
-- links an `Agent` call to the Sub-agent it spawned without pairing them.
-- `spawn_tool_use_id` stays the meta file's fact, the decision's input.
--
-- Backfill of already-ingested conversations is handled by the PARSER_VERSION
-- bump in `src/core/refresh.ts`, not by touching rows here.

-- AlterTable
ALTER TABLE "agent" ADD COLUMN "spawned_by_tool_use_id" TEXT;
