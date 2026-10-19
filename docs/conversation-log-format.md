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
  <dash-encoded-cwd>/                         ← one log folder per launch directory
      <sessionId>.jsonl                       ← one main conversation (session)
      <sessionId>/
          subagents/
              agent-<agentId>.jsonl           ← one full transcript per sub-agent
```

- **Folder name** is the project's absolute cwd with `/` replaced by `-`
  (e.g. `-Users-me-Documents-dev-pvm2-0` ⇒ `/Users/me/Documents/dev/pvm2.0`).
  Note this is lossy/ambiguous in theory (a real `-` vs a `/`), but each
  `assistant`/`user` record also carries an exact `cwd` field, which is the
  authoritative source for the project path. Prefer `cwd` over decoding the
  folder name. A session that enters a git worktree
  (`<repo>/.claude/worktrees/<name>`) is filed under the worktree's folder,
  though its first records state the repo's `cwd`; some sessions state no `cwd`
  at all. How the analyzer derives the Project path from both: GLOSSARY.md,
  Project, and `ParsedSession.projectPath` in `src/core/parse.ts`.
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

| `type`                  | ~count | What it is                                                                                                                                                                 | Modeled?                                 |
| ----------------------- | ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------- |
| `assistant`             | 11808  | An assistant turn (see §3). Carries `message.usage`, `message.model`, content blocks, attribution.                                                                         | **Yes** → `message` (+ `tool_call`)      |
| `user`                  | 7251   | A user message OR a `tool_result` carrier (see §4).                                                                                                                        | **Yes** → `message` / feeds `tool_call`  |
| `attachment`            | 3105   | A dict `attachment` tied to a message via `parentUuid`: pasted content (images, files), or a `queued_command` — a message delivered while the agent was working (§8).      | **Partly** → `queued_command` only (§8)  |
| `ai-title`              | 1252   | `aiTitle`: AI-generated conversation title.                                                                                                                                | **Yes** → `conversation.title`           |
| `mode`                  | 1016   | `mode` (e.g. `normal`) state marker.                                                                                                                                       | **No** (low value)                       |
| `permission-mode`       | 1013   | `permissionMode` (e.g. `default`, `plan`) state marker. Also present per-turn on `user` records.                                                                           | **Partly** (per-turn field on `message`) |
| `last-prompt`           | 992    | `lastPrompt` text + `leafUuid`. Duplicates content already in `user` records.                                                                                              | **No** (redundant)                       |
| `file-history-snapshot` | 798    | `snapshot` dict = file contents for undo/checkpoint, keyed to a `messageId`. Lets you reconstruct which files changed + diffs.                                             | **No** (large; see §6)                   |
| `queue-operation`       | 632    | Queued user input (`operation: enqueue`, `content`).                                                                                                                       | **No**                                   |
| `system`                | 522    | Meta events by `subtype`: `turn_duration` (`durationMs`, `messageCount`), compaction (`compactMetadata`), API retries (`retryAttempt`, `maxRetries`, `retryInMs`), errors. | **Partly** → `turn_duration` table only  |
| `pr-link`               | 78     | `prNumber`, `prUrl`, `prRepository` — a PR surfaced in the session.                                                                                                        | **Yes** → `pr_link`                      |
| `bridge-session`        | 58     | `bridgeSessionId` — links a CLI session to a web/bridge session.                                                                                                           | **No**                                   |
| `agent-name`            | 50     | `agentName` — a name assigned to a (sub)agent session.                                                                                                                     | **No**                                   |
| `agent-setting`         | 23     | `agentSetting` (e.g. `claude`).                                                                                                                                            | **No**                                   |
| `worktree-state`        | 15     | `worktreeSession` dict — git worktree association.                                                                                                                         | **No**                                   |
| `custom-title`          | 15     | `customTitle` — user-set conversation title.                                                                                                                               | **Consider** (overrides `ai-title`)      |

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

Its `status` is one of two values:

- `completed` — a foreground sub-agent that has finished. The ledger above,
  plus its **hand-back** in `content`: an array of `{ type: "text", text }`
  blocks. When the hand-back was sent as a message (`handback: "send"`), the
  report is in `handbackReport.text` and `content` holds only a pointer note
  saying the report was delivered as a message.
- `async_launched` — a background launch: `agentId`, `description`, `prompt`,
  `resolvedModel`, `isAsync`, `outputFile`, `canReadOutputFile`, and no
  `agentType`, totals or hand-back. The hand-back arrives later as an
  Inter-agent message.

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
more complete signal because it tags _every_ turn the skill drove, not just the
invoking turn.)

## 6. What we deliberately did NOT model (and where it lives)

If a future feature needs these, they are re-derivable from the same `.jsonl`
files without schema-breaking surprises — this section is the pointer.

- **Thinking / reasoning text — NOT AVAILABLE AT ALL.** `thinking` blocks store
  only a `signature` (opaque, ~1KB); the `thinking` text field is empty. There
  is no way to recover assistant reasoning from these logs. Do not promise it.
- **File-history snapshots** (`file-history-snapshot.snapshot`): full file
  contents per checkpoint, keyed by `messageId`. This is how you'd reconstruct
  _which files changed and their diffs_. Skipped for size/complexity.
- **Attachments** (`attachment` records) other than `queued_command`: pasted
  images/files. Skipped (large/binary). `queued_command` attachments ARE
  modeled (§8).
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
api-error flag, PR links, turn durations, and each user Message's kind and
`origin` extras (§8).

## 7. Refresh implication

Because the modeled subset is a strict, deterministic projection of these files,
re-parsing is idempotent. Incremental refresh can key off each conversation
file's mtime/size (stored on `conversation`). Anything in §6 can be added later
by extending the parser and re-reading — the raw logs are the durable source of
truth; the SQLite DB is a disposable, rebuildable cache.

## 8. Who a user message is from: `origin`, and mid-turn delivery

Recent Claude Code versions put a top-level **`origin`** object on `user`
records, saying who the message is from. It decides the user Message kind
(GLOSSARY.md) before `isMeta` does; records without one (older logs, sub-agent
task prompts) keep the `tool_result` / `isMeta` rules. Shapes seen (Oct 2026):

| `origin.kind`       | Fields                                                                                                                                                            | Kind                                                    |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| `human`             | —                                                                                                                                                                 | Prompt (see the `isMeta` exception below)               |
| `plugin`            | `name`, `asUser`                                                                                                                                                  | Prompt when `asUser: true`; otherwise the older rules   |
| `peer`              | `from`, `name`, `body`; a Sub-agent adds `senderTaskId`, a hand-back `handback` (+ `handbackReportText`); another session `msg_id`, `fromMode`, `verifiedPeerPid` | Inter-agent message, always `isMeta: true`              |
| `coordinator`       | —                                                                                                                                                                 | Inter-agent message (from the spawning agent), `isMeta` |
| `task-notification` | sometimes `producer`, `runId`                                                                                                                                     | Task notification                                       |
| anything else       | e.g. `auto-continuation`                                                                                                                                          | the older rules                                         |

- **Peer messages.** The record text wraps the message
  (`Another Claude session sent a message:\n<agent-message from=…>` or
  `<cross-session-message …>`); `body` is the message alone. From a Sub-agent
  of the same Conversation, `senderTaskId` is its agent id (the
  `agent-<id>.jsonl` name) and `name` its type, sometimes absent; from another
  session, `from` is a `uds:` socket path and `name` that session's name. A
  hand-back's `body` starts with a harness frame; `handbackReportText`, when
  present, is the report (sometimes behind a `[harness: …]` neutralization
  note).
- **Coordinator messages** carry no `body`. The text starts with the exact line
  `The coordinator sent a message while you were working:`.
- **`isMeta` human records** are machinery (skill instructions, command
  caveats) — except a mid-turn user message, whose text is
  `The user sent a new message while you were working:\n<text>\n\nThis is how Claude Code surfaces messages the user sends mid-turn …`.
- **Task notifications** are XML in the text, sometimes behind a
  `[SYSTEM NOTIFICATION - NOT USER INPUT]` preamble:
  `<task-notification>` with `<task-id>` (a Sub-agent's agent id for agent
  tasks, else a background task id), `<tool-use-id>`, `<output-file>`,
  `<status>` (`completed`, `failed`, `killed`, `stopped`), `<summary>`
  (`Agent "…" finished`, `Background command "…" failed with exit code 1`,
  `Monitor event: "…"`), `<note>`, `<result>` (entity-escaped: `&lt;`, `&amp;`),
  `<usage>`; a Monitor event has `<event>` and no status. A few are plain text
  (`Background agent "…" was stopped by the user.`) or a `<fork-source>` notice.

### Mid-turn delivery: `queued_command` attachments

A Prompt, Inter-agent message or Task notification that arrives while the agent
is working is logged as an `attachment` record:

```json
{
  "type": "attachment",
  "uuid": "…",
  "timestamp": "…",
  "attachment": {
    "type": "queued_command",
    "prompt": "…",
    "origin": { "kind": "human" },
    "commandMode": "prompt",
    "source_uuid": "…",
    "isMeta": true,
    "timestamp": "…"
  }
}
```

- `prompt` is a string or a content-block array (pasted images included);
  `origin`, `isMeta`, `commandMode` (`prompt` / `task-notification`),
  `source_uuid`, `delivery_id` and the attachment's own `timestamp` are each
  sometimes absent (coordinator messages have no attachment timestamp). Older
  attachments have no `origin`; their `commandMode` tells a Task notification.
- It is classified like a `user` record, timestamped from the attachment (else
  the record), and — for a Prompt or Inter-agent message — flagged mid-turn.
  One difference: a `human` origin is a Prompt even with `isMeta: true` (seen
  on prompts typed into a running Sub-agent). The mid-turn wrapper lives in
  the record's `rendered`, never in `prompt`, so the exact-wrapper rule above
  is for `user` records only.
- **Duplicates.** One message delivered both as an attachment and as a `user`
  record was expected, but none were found in Oct 2026 logs: no attachment's
  `source_uuid` matches a record `uuid`, and no attachment repeats a record's
  `msg_id` or body within a file (forked sessions copy history across files,
  which is a different matter). The parser still drops an attachment whose
  `source_uuid` or peer `msg_id` was already seen on a kept message — ids only,
  never text or time.

### How they are stored

`message.kind` is the single discriminator (`inter-agent`, `task-notification`
next to the older kinds). `message.text` is the display body — a peer's `body`
(a hand-back's report text), a coordinator or mid-turn user message without its
exact wrapper line, a notification's `result` (else `event`). Everything else
the transcript needs goes into `message.origin`, a small JSON value in the
normalized shape of `messageOriginSchema` (`src/core/parse.ts`) — never the raw
log object. Search indexes Inter-agent messages, never Task notifications.
