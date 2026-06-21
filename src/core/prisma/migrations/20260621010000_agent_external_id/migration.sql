-- Store the on-disk sub-agent id (`agent-<id>.jsonl`) so the detail view can
-- report each sub-agent by its real id. NULL for the root/main agent.
ALTER TABLE "agent" ADD COLUMN "external_agent_id" TEXT;
