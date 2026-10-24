-- A Sub-agent's lineage is resolved from stored facts (issue #304, ADR-0011):
-- its meta file's `toolUseId` and its file's own dominant model are stored as
-- extracted facts, so the links pass decides `parent_agent_id`,
-- `spawned_by_message_id`, `agent_type` and `resolved_model` without reading
-- any log or meta file.
--
-- Backfill of already-ingested conversations is handled by the PARSER_VERSION
-- bump in `src/core/refresh.ts`, not by touching rows here.

-- AlterTable
ALTER TABLE "agent" ADD COLUMN "spawn_tool_use_id" TEXT;
ALTER TABLE "agent" ADD COLUMN "dominant_model" TEXT;
