# Token accounting and the SQLite data model

## Status

accepted

## Context

The app reports per-conversation token usage and hypothetical API cost by
parsing Claude Code's on-disk logs (`~/.claude/projects/<project>/`). Three
facts about that data drove the model, none of them obvious from a glance:

1. **A conversation's main-thread usage is reported per _turn_, and the same
   turn can appear in multiple JSONL Records** (one per content block), each
   repeating the identical `usage`. Summing Records naively double-counts;
   usage must be deduplicated by `message.id` before summing.
2. **Sub-agents (spawned via the `Agent` tool) have their own full transcript
   files** at `<sessionId>/subagents/agent-<agentId>.jsonl`, with `isSidechain:
true` and the same per-turn `usage` shape as the main thread — often on a
   different (cheaper) resolved model. The spawning `Agent` call _also_ mirrors
   the sub-agent's aggregated ledger into its `toolUseResult`. These are the
   **same tokens**, so counting both double-counts.
3. A main thread and a sub-agent are structurally **the same thing** — a
   transcript of Claude doing work — differing only by file location and
   lineage.

## Decision

Model the domain as twelve tables:

- `project` — one per Project path: the directory its Conversations run in,
  per their records' `cwd` (GLOSSARY.md, Project), not the log folder they are
  filed in.
- `conversation` — one per top-level `<sessionId>.jsonl`; the user-facing row.
  Carries `title`, `git_branch`, Claude Code `version`, file mtime/size for
  incremental refresh, and `continued_from_conversation_id` — the session it
  was resumed or forked from (a `--resume`/fork). Such a session's file copies
  its parent's records, uuids included, rather than pointing back into them
  (amended by issue #284; it first read the first message's `parentUuid`, a
  shape real logs never produce): the parent is the Conversation whose
  `continued-in` record names it, else the one whose Main-thread messages it
  holds all of, ties to the smallest `source_path` (log-format §10).
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
  `_mcp_server`), `permission_mode`, an API-error flag, `timestamp`, and
  `is_copied` — whether a continuation copied it from its parent (a Copied
  Message, log-format §10). FK to
  `agent`. Main and sub-agents are parsed identically. Content (text) and
  accounting (tokens) deliberately co-locate here because they describe the
  same turn and share its key — a feature for a small read-mostly analytics DB.
- `tool_call` — one per `tool_use` block, FK to `message` + `agent`.
- `pr_link` — PRs surfaced in a conversation (`pr-link` records).
- `turn_duration` — wall-clock turn timings (`system/turn_duration` records).
- `api_request` — one per API request a Recording holds for the
  Conversation's session (ADR-0006): its ids, status and timings, FK to
  `conversation`, and to the matched Turn's `message` and `agent` (NULL when no
  Turn matches). Never what was sent: request bodies grow with the square of
  the Conversation, and stay in the Recording. Superseded by ADR-0007: API
  requests come from the logs, their pieces stored once in the database.
- `logged_api_request` — one per `api-request` record Claude Code 2.1.300+
  logs (ADR-0007), in any of the Conversation's files: FK to `conversation`,
  to the file's `agent`, and to the Turn's `message` whose `requestRef` names
  it within that file (NULL otherwise), with its parameters (never
  `safeguards`), cache breakpoints, send time and `base`/`keep`/`tail`.
- `system_prompt`, `tool_set` — each distinct system prompt and set of tool
  definitions a `logged_api_request` sent, once, under the sha256 of its
  canonical JSON, shared across Conversations; a Refresh deletes those no
  request references any more.
- `sent_message` — each distinct message a `logged_api_request`'s `tail`
  names, once, under that hash, shared across Conversations; a Refresh deletes
  those no tail names any more. A request's whole message list is rebuilt at
  read time from its `base` chain.
- `continued_in` — one per `continued-in` record of a Conversation's main
  file: the session it was resumed or forked into (log-format §10), FK to
  `conversation`.

Token accounting rules:

- **Transcript files are the single source of truth.** The sub-agent
  aggregate in a parent's `toolUseResult` is used only as a cross-check, never
  summed into totals. (ADR-0006 narrowed this to Turns; ADR-0007 restores it.)
- Conversation/project/agent totals are `SUM` queries over `message`, never
  stored aggregates.
- Because each assistant turn carries both `usage` and an `attribution_skill`/
  `_agent`/`_plugin`/`_mcp_server`, **per-skill and per-agent-type token cost
  are deterministic** (`SUM(...) WHERE attribution_skill = ?`). Only per-
  _individual-tool-call_ cost remains non-exact (it lives at turn grain).
- Cost is **computed in application code** from a per-model, per-token-type
  price list — not stored in the DB — so re-pricing never requires a re-parse.

## Consequences

- The schema is a reusable raw substrate, not a pre-baked report: new analyses
  are new queries, not new parsers.
- `tool_call` stores `input_json` in full (small; powers skill/CLI detection),
  the result plus `result_char_size` (full length, used as a token-cost proxy)
  and `is_error`. Whether a result is stored whole or **truncated to ~10k
  chars** is a per-tool rule. Most results are file contents and command output
  the logs already hold, together over a gigabyte, so they are truncated and
  the DB stays bounded; the rare full blob can be re-read from disk. An `Agent`
  call's result carries the Sub-agent's hand-back, which is read in full in the
  Transcript, and all of them together weigh megabytes, so it is stored whole.
- **Per-tool-call token cost is only exact for `Agent` calls** (the sub-agent's
  own usage). All other tools have no recorded per-call token cost — only their
  Turn's usage — so their cost is attributed at Turn grain or approximated by
  `result_char_size`.
- Self-referential `parent_agent_id` supports arbitrary agent nesting, but the
  data only exposes depth-1 (a sub-agent's aggregate already rolls in any
  deeper descendants), so deeper trees are structurally allowed yet never
  populated from current logs.
