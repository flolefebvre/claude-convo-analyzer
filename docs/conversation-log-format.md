# Claude Code conversation log format (reference)

Empirically reverse-engineered from the logs on this machine (Claude Code
versions ~2.1.145–2.1.185, June 2026). This is a **reference map** so future
work does not have to re-derive the format by re-parsing. It records what the
files contain, the non-obvious gotchas, and — importantly — **what we
deliberately did not model** (and where to find it if we ever want it).

> Numbers below (counts, sizes) are from one snapshot of one machine and are
> illustrative of shape/scale, not contractual.

## 1. On-disk layout

```
~/.claude/projects/
  <dash-encoded-cwd>/                         ← one folder per project (working dir)
      <sessionId>.jsonl                       ← one main conversation (session)
      <sessionId>/
          subagents/
              agent-<agentId>.jsonl           ← one full transcript per sub-agent
```

- **Folder name** is the project's absolute cwd with `/` replaced by `-`
  (e.g. `-Users-prezbar-Documents-dev-pvm2-0` ⇒ `/Users/prezbar/Documents/dev/pvm2.0`).
  Note this is lossy/ambiguous in theory (a real `-` vs a `/`), but each
  `assistant`/`user` record also carries an exact `cwd` field, which is the
  authoritative source for the project path. Prefer `cwd` over decoding the
  folder name.
- **Main conversation** = a top-level `<sessionId>.jsonl`. In the snapshot:
  **418** of these.
- **Sub-agent** = its own complete transcript at
  `<sessionId>/subagents/agent-<agentId>.jsonl`, **93** in the snapshot. Each is
  a real per-turn transcript (not just an aggregate). Its assistant records have
  `isSidechain: true` and typically a different (often cheaper) `model`.
- No deeper on-disk nesting was observed (no sub-agent has its own
  `subagents/`), though the model allows it. A sub-agent's aggregate already
  rolls in any deeper descendants.

Each `.jsonl` file is **one JSON object per line**, each with a `type`.

## 2. Record types

Counts are from the snapshot (across main + sub-agent files combined).

| `type` | ~count | What it is | Modeled? |
|---|---|---|---|
| `assistant` | 11808 | An assistant turn (see §3). Carries `message.usage`, `message.model`, content blocks, attribution. | **Yes** → `message` (+ `tool_call`) |
| `user` | 7251 | A user message OR a `tool_result` carrier (see §4). | **Yes** → `message` / feeds `tool_call` |
| `attachment` | 3105 | Pasted/attached content (images, files) tied to a user message via `parentUuid`. `attachment` is a dict. | **No** (see §6) |
| `ai-title` | 1252 | `aiTitle`: AI-generated conversation title. | **Yes** → `conversation.title` |
| `mode` | 1016 | `mode` (e.g. `normal`) state marker. | **No** (low value) |
| `permission-mode` | 1013 | `permissionMode` (e.g. `default`, `plan`) state marker. Also present per-turn on `user` records. | **Partly** (per-turn field on `message`) |
| `last-prompt` | 992 | `lastPrompt` text + `leafUuid`. Duplicates content already in `user` records. | **No** (redundant) |
| `file-history-snapshot` | 798 | `snapshot` dict = file contents for undo/checkpoint, keyed to a `messageId`. Lets you reconstruct which files changed + diffs. | **No** (large; see §6) |
| `queue-operation` | 632 | Queued user input (`operation: enqueue`, `content`). | **No** |
| `system` | 522 | Meta events by `subtype`: `turn_duration` (`durationMs`, `messageCount`), compaction (`compactMetadata`), API retries (`retryAttempt`, `maxRetries`, `retryInMs`), errors. | **Partly** → `turn_duration` table only |
| `pr-link` | 78 | `prNumber`, `prUrl`, `prRepository` — a PR surfaced in the session. | **Yes** → `pr_link` |
| `bridge-session` | 58 | `bridgeSessionId` — links a CLI session to a web/bridge session. | **No** |
| `agent-name` | 50 | `agentName` — a name assigned to a (sub)agent session. | **No** |
| `agent-setting` | 23 | `agentSetting` (e.g. `claude`). | **No** |
| `worktree-state` | 15 | `worktreeSession` dict — git worktree association. | **No** |
| `custom-title` | 15 | `customTitle` — user-set conversation title. | **Consider** (overrides `ai-title`) |

## 3. The `assistant` record (the heart of accounting)

Key fields: `message` (the Anthropic message), `requestId`, `uuid`,
`parentUuid`, `timestamp`, `cwd`, `gitBranch`, `version` (Claude Code version),
`entrypoint` (`cli` / `sdk-cli`), `isSidechain`, `sessionId`, plus attribution
and error fields below.

`message` contains:
- `model` — resolved model string. Seen: `claude-opus-4-8`, `claude-sonnet-4-6`,
  `claude-opus-4-7`, `claude-haiku-4-5-20251001`, plus aliases `opus` and the
  placeholder `<synthetic>` (synthetic messages — treat as $0).
- `usage` — `{ input_tokens, output_tokens, cache_creation_input_tokens,
  cache_read_input_tokens, cache_creation: { ephemeral_5m_input_tokens,
  ephemeral_1h_input_tokens }, ... }`. Reported **per request/turn**.
- `content` — array of blocks: `text`, `thinking`, `tool_use`. (May also be a
  plain string in some records.)

Attribution fields on the record (present and populated — see §5):
`attributionSkill`, `attributionAgent`, `attributionPlugin`,
`attributionMcpServer`, `attributionMcpTool`.

Error fields: `isApiErrorMessage`, `apiErrorStatus`, `error` (rare: ~3 in
snapshot).

### GOTCHA 1 — deduplicate by message id before summing usage
A single assistant turn can be written as **multiple `assistant` records** (one
per content block), each repeating the **identical `usage`**. In the snapshot,
37 assistant records collapsed to 20 distinct `requestId`/`message.id`. **Sum
usage once per distinct `message.id` (or `requestId`)**, or you double-count.

### GOTCHA 2 — `usage` is per-turn, not cumulative
Sum across the (deduplicated) turns to get a conversation total. It is not a
running total.

## 4. Tools, sub-agents, and the `tool_result`

- A `tool_use` block (inside an `assistant` message) has `name`, `id`, and a
  tool-specific `input`. Examples: `Bash` → `input.command`; `Skill` →
  `input.skill` (+ `args`); `Read`/`Edit`/`Write` → file paths; `Agent` →
  `subagent_type`, `description`, `prompt`. ~6090 tool_use blocks in snapshot.
- The matching `tool_result` lives in a **`user`** record, matched by
  `tool_use_id`, with the raw result in the record's `toolUseResult` field
  (shape varies: Bash → `{stdout, stderr, interrupted, ...}`; Read → file text;
  etc.).

### Sub-agent accounting (the `Agent` tool)
When a `tool_use` is `Agent`, its `tool_result` record's `toolUseResult`
contains an **aggregated ledger** for the spawned sub-agent:
`agentId`, `agentType`, `resolvedModel`, `totalTokens`, `totalToolUseCount`,
`totalDurationMs`, `usage` (full split), `toolStats`
(`readCount`/`bashCount`/`editFileCount`/...).

### GOTCHA 3 — sub-agent tokens are recorded twice; count them once
The sub-agent's aggregated `usage` in the parent's `toolUseResult` is the **same
tokens** as the sub-agent's own transcript file (`subagents/agent-<id>.jsonl`).
**The transcript file is the source of truth**; the parent aggregate is only a
cross-check. Counting both double-counts. Link the sub-agent transcript to the
spawning turn via `agentId` (it appears both in the file name and in the
parent's `toolUseResult`).

### GOTCHA 4 — no per-tool-call token counts
There is **no token field on `tool_use` blocks**. Tokens exist only per turn
(`message.usage`) and per sub-agent. So an individual Bash/Read/Edit call has no
exact token cost — only its turn does. The lone exception is `Agent`, whose cost
is exactly the sub-agent ledger. (Skill/agent-type cost is still exact via
attribution — see §5 — because that's turn-level, and tokens are turn-level.)

## 5. Attribution (per-turn skill/agent/plugin/mcp labels)

`assistant` records carry populated attribution fields. Snapshot examples:
- `attributionSkill`: `orchestrate` (1441), `tdd` (1338), `fresh-review` (769),
  `commit` (333), `grill-with-docs` (130), `skill-creator:skill-creator` …
- `attributionAgent`: `general-purpose` (3835), `Explore` (1292),
  `claude-code-guide` (52) …
- `attributionPlugin`: `skill-creator` (34); `attributionMcpServer`:
  `code-review-graph` (130).

Because each turn has **both** usage and attribution, **per-skill / per-agent /
per-plugin / per-mcp token cost is deterministic** — a key analytical capability
worth preserving. (Skills also appear as `Skill` tool calls; attribution is the
more complete signal because it tags *every* turn the skill drove, not just the
invoking turn.)

## 6. What we deliberately did NOT model (and where it lives)

If a future feature needs these, they are re-derivable from the same `.jsonl`
files without schema-breaking surprises — this section is the pointer.

- **Thinking / reasoning text — NOT AVAILABLE AT ALL.** `thinking` blocks store
  only a `signature` (opaque, ~1KB); the `thinking` text field is empty. There
  is no way to recover assistant reasoning from these logs. Do not promise it.
- **File-history snapshots** (`file-history-snapshot.snapshot`): full file
  contents per checkpoint, keyed by `messageId`. This is how you'd reconstruct
  *which files changed and their diffs*. Skipped for size/complexity.
- **Attachments** (`attachment` records): pasted images/files. Skipped
  (large/binary).
- **Compaction events** (`system` with `compactMetadata`): when a conversation
  was auto-summarized. Relevant if you analyze long-conversation behavior.
- **Retries & API errors** (`system` `retryAttempt`/`maxRetries`/`retryInMs`;
  `assistant` `apiErrorStatus`): reliability/wasted-cost signal. Rare here.
- **Queue operations, bridge sessions, worktree state, agent-name/-setting,
  mode markers, last-prompt:** low analytical value; left on disk.

### Modeled subset (see ADR-0001 for the schema)
Tokens/cost (per turn, deduped, per resolved model), tool calls (name + input +
truncated result + size), sub-agent lineage, conversation title, project,
per-turn attribution & timestamps, git branch, CC version, permission mode,
api-error flag, PR links, and turn durations.

## 7. Refresh implication

Because the modeled subset is a strict, deterministic projection of these files,
re-parsing is idempotent. Incremental refresh can key off each conversation
file's mtime/size (stored on `conversation`). Anything in §6 can be added later
by extending the parser and re-reading — the raw logs are the durable source of
truth; the SQLite DB is a disposable, rebuildable cache.
