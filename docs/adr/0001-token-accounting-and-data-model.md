# Token accounting and the SQLite data model

## Status

accepted

## Context

The app reports per-conversation token usage and hypothetical API cost by
parsing Claude Code's on-disk logs (`~/.claude/projects/<project>/`). Three
facts about that data drove the model, none of them obvious from a glance:

1. **A conversation's main-thread usage is reported per *turn*, and the same
   turn can appear in multiple JSONL Records** (one per content block), each
   repeating the identical `usage`. Summing Records naively double-counts;
   usage must be deduplicated by `message.id` before summing.
2. **Sub-agents (spawned via the `Agent` tool) have their own full transcript
   files** at `<sessionId>/subagents/agent-<agentId>.jsonl`, with `isSidechain:
   true` and the same per-turn `usage` shape as the main thread — often on a
   different (cheaper) resolved model. The spawning `Agent` call *also* mirrors
   the sub-agent's aggregated ledger into its `toolUseResult`. These are the
   **same tokens**, so counting both double-counts.
3. A main thread and a sub-agent are structurally **the same thing** — a
   transcript of Claude doing work — differing only by file location and
   lineage.

## Decision

Model the domain as seven tables:

- `project` — one per `~/.claude/projects/` folder (decoded cwd).
- `conversation` — one per top-level `<sessionId>.jsonl`; the user-facing row.
  Carries `title`, `git_branch`, Claude Code `version`, file mtime/size for
  incremental refresh, and `continued_from_conversation_id` — set when the
  conversation's first message `parentUuid` resolves (via the message-uuid index
  built during parsing) to a message in a prior session (a `--resume`/fork).
  Each session file remains an independent row (resumed sessions are genuinely
  new API spend, so totals never double-count); the link only enables a future
  thread view.
- `agent` — one per transcript (main **and** sub), self-referential via
  `parent_agent_id` (NULL ⇒ root/main agent). Carries per-agent metadata
  (`agent_type`, `resolved_model`, duration, tool counts) and, for sub-agents,
  `spawned_by_message_id` linking back to the exact main-thread turn that
  launched it.
- `message` — **one row per user or assistant message** (deduplicated by
  `message.id` for assistant turns). Holds, on the same row, the message
  `role`, optional `text`, the token split (`input`, `output`,
  `cache_creation_5m`, `cache_creation_1h`, `cache_read` — NULL for user
  messages, which have no usage of their own), `model`, the per-turn
  attribution fields (`attribution_skill` / `_agent` / `_plugin` /
  `_mcp_server`), `permission_mode`, an API-error flag, and `timestamp`. FK to
  `agent`. Main and sub-agents are parsed identically. Content (text) and
  accounting (tokens) deliberately co-locate here because they describe the
  same turn and share its key — a feature for a small read-mostly analytics DB.
- `tool_call` — one per `tool_use` block, FK to `message` + `agent`.
- `pr_link` — PRs surfaced in a conversation (`pr-link` records).
- `turn_duration` — wall-clock turn timings (`system/turn_duration` records).

Token accounting rules:

- **Transcript files are the single source of truth.** The sub-agent
  aggregate in a parent's `toolUseResult` is used only as a cross-check, never
  summed into totals.
- Conversation/project/agent totals are `SUM` queries over `message`, never
  stored aggregates.
- Because each assistant turn carries both `usage` and an `attribution_skill`/
  `_agent`/`_plugin`/`_mcp_server`, **per-skill and per-agent-type token cost
  are deterministic** (`SUM(...) WHERE attribution_skill = ?`). Only per-
  *individual-tool-call* cost remains non-exact (it lives at turn grain).
- Cost is **computed in application code** from a per-model, per-token-type
  price list — not stored in the DB — so re-pricing never requires a re-parse.

## Consequences

- The schema is a reusable raw substrate, not a pre-baked report: new analyses
  are new queries, not new parsers.
- `tool_call` stores `input_json` in full (small; powers skill/CLI detection),
  the result **truncated to ~10k chars** plus `result_char_size` (full length,
  used as a token-cost proxy) and `is_error`. The DB stays bounded; the rare
  full blob can be re-read from disk.
- **Per-tool-call token cost is only exact for `Agent` calls** (the sub-agent's
  own usage). All other tools have no recorded per-call token cost — only their
  Turn's usage — so their cost is attributed at Turn grain or approximated by
  `result_char_size`.
- Self-referential `parent_agent_id` supports arbitrary agent nesting, but the
  data only exposes depth-1 (a sub-agent's aggregate already rolls in any
  deeper descendants), so deeper trees are structurally allowed yet never
  populated from current logs.
