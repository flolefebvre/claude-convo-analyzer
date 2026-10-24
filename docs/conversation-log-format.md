# Claude Code conversation log format (reference)

Empirically reverse-engineered from the logs on this machine (Claude Code
versions ~2.1.143–2.1.309, June–October 2026: §1–§7 were mapped on
2.1.145–2.1.185, §8–§10 on later versions). This is a **reference map** so
future work does not have to re-derive the format by re-parsing. It records
what the files contain, the non-obvious gotchas, and — importantly — **what we
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
              agent-<agentId>.meta.json       ← its spawn, as Claude Code states it (§4)
```

- **Folder name** is the project's absolute cwd with `/` replaced by `-`
  (e.g. `-Users-me-Documents-dev-pvm2-0` ⇒ `/Users/me/Documents/dev/pvm2.0`).
  On native Windows the cwd is a Windows path, and its drive colon and each `\`
  are replaced by `-` too (`C--Users-me-repo` ⇒ `C:\Users\me\repo`).
  Note this is lossy/ambiguous in theory (a real `-` vs a separator), but each
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

| `type`                  | ~count | What it is                                                                                                                                                                                                                                              | Modeled?                                   |
| ----------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| `assistant`             | 11808  | An assistant turn (see §3). Carries `message.usage`, `message.model`, content blocks, attribution.                                                                                                                                                      | **Yes** → `message` (+ `tool_call`)        |
| `user`                  | 7251   | A user message OR a `tool_result` carrier (see §4).                                                                                                                                                                                                     | **Yes** → `message` / feeds `tool_call`    |
| `attachment`            | 3105   | A dict `attachment` tied to a message via `parentUuid`: pasted content (images, files), a `queued_command` — a message delivered while the agent was working (§8) — or, since 2.1.266, injected context with the text the model saw in `rendered` (§9). | **Partly** → `queued_command`, `rendered`  |
| `ai-title`              | 1252   | `aiTitle`: AI-generated conversation title, re-written as the session goes: the **last** wins, `""` clears it, a record without a string is skipped. 1,867 of 2,650 originals carry ≥2; 25 with ≥2 distinct values (Oct 2026).                          | **Yes** → `conversation.title`             |
| `mode`                  | 1016   | `mode` (e.g. `normal`) state marker.                                                                                                                                                                                                                    | **No** (low value)                         |
| `permission-mode`       | 1013   | `permissionMode` (e.g. `default`, `plan`) state marker. Also present per-turn on `user` records.                                                                                                                                                        | **Partly** (per-turn field on `message`)   |
| `last-prompt`           | 992    | `lastPrompt` text + `leafUuid`. Duplicates content already in `user` records.                                                                                                                                                                           | **No** (redundant)                         |
| `file-history-snapshot` | 798    | `snapshot` dict = file contents for undo/checkpoint, keyed to a `messageId`. Lets you reconstruct which files changed + diffs.                                                                                                                          | **No** (large; see §6)                     |
| `queue-operation`       | 632    | Queued user input (`operation: enqueue`, `content`).                                                                                                                                                                                                    | **No**                                     |
| `system`                | 522    | Meta events by `subtype`: `turn_duration` (`durationMs`, `messageCount`), compaction (`compactMetadata`), API retries (`retryAttempt`, `maxRetries`, `retryInMs`), errors.                                                                              | **Partly** → `turn_duration` table only    |
| `pr-link`               | 78     | `prNumber`, `prUrl`, `prRepository` — a PR surfaced in the session.                                                                                                                                                                                     | **Yes** → `pr_link`                        |
| `bridge-session`        | 58     | `bridgeSessionId` — links a CLI session to a web/bridge session.                                                                                                                                                                                        | **No**                                     |
| `agent-name`            | 50     | `agentName` — a name assigned to a (sub)agent session.                                                                                                                                                                                                  | **No**                                     |
| `agent-setting`         | 23     | `agentSetting` (e.g. `claude`).                                                                                                                                                                                                                         | **No**                                     |
| `worktree-state`        | 15     | `worktreeSession` dict — git worktree association.                                                                                                                                                                                                      | **No**                                     |
| `custom-title`          | 15     | `customTitle` — user-set conversation title; the **last** wins, as for `ai-title`, and overrides it. 1,922 records (Oct 2026), 133 files with several, none empty.                                                                                      | **Yes** → `conversation.title`             |
| `api-request`           | §9     | One API request an Agent sent, since 2.1.300: its parameters, and pointers to its system prompt, tools and messages.                                                                                                                                    | **Yes** → `api_request` (§9)               |
| `api-request-shape`     | §9     | The system prompt and tools of `api-request`s, stored once under `shapeHash`.                                                                                                                                                                           | **Yes** → `system_prompt`, `tool_set` (§9) |
| `api-request-blob`      | §9     | One message of `api-request`s, stored once under its hash.                                                                                                                                                                                              | **Yes** → `sent_message` (§9)              |
| `cost-state`            | §9     | Claude Code's own per-process cost and usage totals.                                                                                                                                                                                                    | **No** (§9)                                |
| `continued-in`          | §10    | `continuedInSessionId`: the session this one was resumed or forked into, written in the parent's file (2.1.296+).                                                                                                                                       | **Yes** → `continued_in` (§10)             |

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

### Thinking — rarely any text, and only a summary

`thinking` blocks store a `signature` (opaque, ~1KB) and a `thinking` text
field that is usually empty. When it is not, it is short (median 224
characters, never over 500 in the scan), a summary rather than the full
reasoning. By version (Oct 2026 scan, 102,700 blocks):

| Claude Code       | `thinkingDisplay` on the record | Non-empty `thinking`   |
| ----------------- | ------------------------------- | ---------------------- |
| before 2.1.241    | absent                          | never (0 of 40,324)    |
| 2.1.241 – 2.1.295 | absent                          | 2.5% (881 of 34,789)   |
| 2.1.296 and later | `updates`                       | 6.0% (1,648 of 27,524) |
| 2.1.296 and later | `omitted`                       | never (0 of 63)        |

From 2.1.296 every record with a thinking block carries `thinkingDisplay`
(the request's `params.thinking.display`, §9). So: text can be non-empty from
2.1.241 on, except when `thinkingDisplay` is `omitted`; an empty one is the
norm, never a sign of a broken record. Do not promise the reasoning itself.

From 2.1.287 a record holding a thinking block also carries
`thinkingDurationMs`. The thinking block is the first line of its turn. A
turn with two thinking lines carries a duration on each, the second a few ms
(1–7 ms in an Oct 2026 scan of 362 such turns).

Each turn's thinking is stored on its `message` row: `thinking_text`, the
non-empty `thinking` texts of all its lines joined in order (NULL when every
block is empty), and `thinking_duration_ms`, the sum of its lines'
`thinkingDurationMs` (NULL when none carries it). `thinkingDisplay` is not
stored.

### GOTCHA 1 — deduplicate by message id before summing usage

A single assistant turn can be written as **multiple `assistant` records** (one
per content block), each carrying the turn's `usage` as it stood when that
record was written. In the snapshot, 37 assistant records collapsed to 20
distinct `requestId`/`message.id`. **Count usage once per distinct
`message.id` (or `requestId`)**, or you double-count.

The records do not always repeat the same `usage`: in a Sub-agent's turn,
`output_tokens` grows from record to record as the response streams. Measured
on 392,912 `assistant` records (2.1.143–2.1.310, Oct 2026): of the 133,008
turns written as several records, 42,774 grow, all but 2 of them Sub-agents'.
Their first records' output sums to 71.0 M tokens, their last records' to
111.3 M: taking the first record misses 36 % of output. The other buckets never
change between records, and the last record's values are always the highest.
So **a turn's usage is the highest value of each bucket across its records**;
its model, timestamp, effort and attribution are the first record's.

The same holds across files (ADR-0011): a resumed or forked session, and a
forked Sub-agent, copy the records of Turns they did not make (§10), and a
spawner's file can keep a partial `output_tokens` where its fork's copy holds
the final one. A Turn is one API response, identified by its `message.id`
across all the logs when its record carries a `requestId` — a mock API's
(`msg_fake*`, no `requestId`) reuses ids across unrelated sessions, so such a
Turn is its own file's. Each file holding it holds an **occurrence**; its
usage is the highest value of each bucket over every occurrence, and it counts
once, in the Cost of the Conversation whose Agent owns it (§10, "How they are
stored").

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

A spawn interrupted before its result, or still running, has no ledger at all.

### The meta file: `agent-<agentId>.meta.json`

Beside each Sub-agent transcript Claude Code writes one JSON object, at the
spawn (before the transcript has content), and may rewrite it when the
Sub-agent finishes. Measured on 2,528 Sub-agent transcripts, October 2026: all
2,528 have one. Its keys, by how many files hold them: `agentType` 2,528,
`description` 2,528, `toolUseId` 2,526, `spawnDepth` 2,341, `requestShape`
1,255 (`background` 1,247, `foreground` 8), `model` 700, `parentAgentId` 283,
`isFork` 16; then keys written at completion (`finished` 556, `stoppedByUser`
16, `worktreeCleanlyRemoved` 11, `worktreePath`…). `agentType` and `toolUseId`
are set at the spawn and never change.

Before the meta file was read, 2,057 of 2,521 stored Sub-agents (82 %) had no
type, because a background launch's ledger states none. Reading it, a cold
Refresh of the same logs types all 2,523. 35 Sub-agents are named by no ledger
in any file of their Conversation; 33 of them are linked to their spawning
Message through the meta file's `toolUseId` (21 nested). The other 2 are
Main-thread forks, whose meta files have no `toolUseId`.

### Where a Sub-agent's spawn comes from

**The meta file decides (ADR-0011).** Its `toolUseId` names the spawning
`Agent` call, and its `agentType` is the type. The ledger naming the
Sub-agent is the fallback, read for a field only when the meta file states
none for it; a malformed meta file states nothing, and the Refresh goes on.

- **The spawning call**: the meta file's `toolUseId`, else the `tool_use_id`
  of a stored `Agent` call of the Conversation whose ledger names the
  Sub-agent (of several, the smallest).
- **The spawner**: the Agent owning that call, by the ownership rule of §10,
  among the Agents of the same Conversation holding it — never the Sub-agent
  itself nor one of its descendants, since a fork copies its own spawn record,
  re-written, and a fork of a fork copies it again. A resumed session's copy
  of the call lives in another Conversation and never counts. The Main
  thread, when it holds the call, is everyone's ancestor and owns it.
  `spawned_by_message_id` is the spawner's Message holding the call.
- **Without a spawning call, or no other holder of it**: the Main thread, with
  no spawning Message (the 2 Main-thread forks on this machine).
- **The type**: the meta file's `agentType`, else the ledger's — the result of
  the spawning call the spawner holds, when it names the Sub-agent.
- **The resolved model**: that ledger's `resolvedModel`, else the
  transcript's dominant model (the meta file's `model` is not read).

The `isFork`, `parentAgentId`, `description` and `spawnDepth` keys are not read:
the `Agent` call already gives the spawn link.

Who descends from whom is what the rule decides, so the Refresh decides a
Conversation's Sub-agents together, in `source_path` order, until none is
left: one is decided once the Agents holding its call have their own spawner
settled down to the Main thread, the Main thread holds it, or at most one
holder is left. A holder whose decided chain of spawners reaches the
Sub-agent is never picked, so no link closes a cycle. When holders each wait
on another — a fork that forks twice, its first fork holding its spawn record
and the second holding both — the first pending Sub-agent with a settled
holder is decided among its settled holders only: a settled holder cannot
descend from it, so its spawner is among them. With none anywhere, which
Claude Code never writes, the first goes under the Main thread.

**How it is stored.** A Sub-agent's file is parsed for what it states alone:
its `agent` row keeps its meta file's `toolUseId` (`spawn_tool_use_id`) and
`agentType`, and its own dominant model (`dominant_model`); its `Agent` calls
keep their results whole, each a ledger (`tool_call.result_text`). The meta
facts are extracted again on every write of the Conversation, a kept
Sub-agent's included, so a meta file that appears counts once any file of
its Conversation changes. A meta file is not part of the change key
(ADR-0010): one that appears while no transcript of its Conversation changes
waits for that Conversation's next change. Claude Code writes the meta file
before the transcript, so this shape practically never happens.

The links pass then resolves `parent_agent_id`, `spawned_by_message_id`,
`agent_type` and `resolved_model` from those stored rows, for every
Conversation the Refresh wrote: lineage never crosses a Conversation. No file
is read for it, so a cold Refresh and an incremental one reach the same rows
whatever files a run parsed, and a changed Sub-agent costs its own file's
parse alone — its spawner's stays unread.

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

- **File-history snapshots** (`file-history-snapshot.snapshot`): full file
  contents per checkpoint, keyed by `messageId`. This is how you'd reconstruct
  _which files changed and their diffs_. Skipped for size/complexity.
- **Attachments** (`attachment` records) other than `queued_command`: pasted
  images/files, and the injected context of §9. Skipped (large/binary).
  `queued_command` attachments ARE modeled (§8).
- **`cost-state`** (§9). The `api-request`, `api-request-shape` and
  `api-request-blob` records ARE modeled (§9, "How they are stored").
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
api-error flag, PR links, turn durations, each turn's thinking text and
duration (§3, "Thinking"), each user Message's kind and
`origin` extras (§8), each API request's parameters, system prompt, tools
and messages (§9), and which session a Conversation continues and which of its
Messages it copied (§10).

## 7. Refresh implication

Because the modeled subset is a strict, deterministic projection of these files,
re-parsing is idempotent. Incremental refresh can key off each conversation
file's mtime/size (stored on `conversation`). Anything in §6 can be added later
by extending the parser and re-reading — the raw logs are the durable source of
truth; the SQLite DB is a disposable, rebuildable cache. The stores shared
across Conversations — the system prompts, tool sets and sent messages of §9 —
keep that property: each is interned, and a Refresh ends by deleting every
interned value no request references, so a re-parse leaves the database a cold
Refresh would write. So do a Turn's links to a request in another
Conversation's file: a Refresh ends by linking every Turn left without one
(§9, "How they are stored"). So does a Sub-agent's spawner: a Refresh resolves
it from stored rows for every Conversation it wrote (§4). And so do continuations: a Refresh decides again
the parent of every Conversation its writes and deletes could change, the
owner and usage of every Turn they could change, and the owner of every user
Message they could change — which makes its other occurrences Copied Messages
(§10, "How they are stored").

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

## 9. Request records and rendered context (2.1.266+)

Since **2.1.300** every log file — main thread and sub-agent transcript alike —
records each API request its Agent sent: the system prompt, the tools, every
message and the parameters, enough to rebuild the request body. Since
**2.1.266** the injected-context attachments carry the text the model saw. The
numbers below come from an October 2026 scan of this machine: 4,942 files, 750
of them with 2.1.300+ records (330 main Conversations), about 27,500
`api-request` records (9,400 main-thread, 18,000 sub-agent). The logs grow as
they are scanned, so counts from different probes differ slightly.

### Request records (2.1.300+)

Three record types, each carrying `sessionId`; in a sub-agent file, also
`agentId`.

**`api-request`** — one API request:

| Field           | What it is                                                                                                                                                                                                                                                                   |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`            | What an `assistant` record's `requestRef` points to.                                                                                                                                                                                                                         |
| `base`, `keep`  | The request's messages start with the first `keep` messages of the `base` request, always the previous `api-request` in the same file. `base` is optional (step 1 below).                                                                                                    |
| `tail`          | The hashes of the messages that follow, in order.                                                                                                                                                                                                                            |
| `shapeHash`     | The `api-request-shape` holding the system prompt and tools.                                                                                                                                                                                                                 |
| `params`        | `model`, `betas`, `max_tokens`, `thinking` (`{type: "adaptive", display: "updates" \| "omitted"}`), `context_management`, `output_config` (`effort` only). On 2.1.300–2.1.303 also `safeguards` (below).                                                                     |
| `cacheControl`  | `[{path, value}]`: where the request's `cache_control` markers go. `path` is `["system", i]` or `["messages", i, "content", j]`; `value` is `{type: "ephemeral"}`, plus `ttl: "1h"` and `scope: "global"` on some. Three per request (two system, one message), rarely four. |
| `querySource`   | `repl_main_thread` or `sdk` in a main file; `agent:builtin:<type>` or `agent:custom:<type>` (the type may be plugin-qualified, `harness:developer`) in a sub-agent file.                                                                                                     |
| `agentId`       | In sub-agent files only (every request there); absent on the main thread.                                                                                                                                                                                                    |
| `requestDigest` | sha256 of the whole request body (below).                                                                                                                                                                                                                                    |
| `timestamp`     | When the request was sent: 2–7 ms before a Recorder received it, on the 15 requests a Recording also holds.                                                                                                                                                                  |

**`api-request-shape`** — `{shapeHash, shape: {system, tools}}`: the system
prompt (an array of blocks) and the tool definitions, as sent, stored once per
file under `shapeHash`. The scan had 1,184 shapes holding 183 distinct system
prompts and 160 distinct tool arrays (112 distinct sets of tool names).

**`api-request-blob`** — `{hash, message}`: one message, stored under its hash.
By count most are `role: "system"` (the injected context, below); by size
nearly all are user messages carrying full tool results.

### Rebuilding a request body

1. **Messages.** `messages(r) = messages(base)[0:keep] + tail.map(resolve)`,
   or just `tail.map(resolve)` when `base` is absent. **`base` is absent if and
   only if `keep` is `0`** (about 1,190 requests in the scan, no exception
   either way). That is the first request of every file, but not only: a
   request can also **start over mid-session**, its whole message list in
   `tail` (12 main-thread and about 435 sub-agent requests in the scan), with
   no compaction or change of `querySource` before it. Never assume a request
   without `base` is the file's first.
2. **Resolving a tail hash.** It names either a blob, or a message rebuilt
   from the file's own records: the `assistant` records sharing one
   `message.id`, their `content` concatenated in order
   (`{role: "assistant", content}`); or **a leading part of a run of
   consecutive `user` records** (no `assistant` record between them) — the
   whole run, or its first _n_ records — concatenated the same way
   (`{role: "user", content}`), a string `content` counting as one text block.
   **The hash** is the sha256 hex of the message's canonical JSON — keys
   sorted, no whitespace, non-ASCII kept as is — **with a string `content`
   rewritten as one text block, `[{type: "text", text}]`, first.** The blob
   carries the string itself (747 blobs in the scan: 722 `system`, 25 `user`),
   as does the wire (seen on the 20 string `system` messages Recordings
   hold), so a string-content message never matches its hash as stored:
   rewrite it to hash, keep the string to show what was sent. The same rule
   holds for `requestDigest` (step 5), which only reproduces with it.
3. **Why a leading part: the interrupted Turn.** A request sent with the
   tool-result message, then never answered (the user typed, interrupted or
   exited), leaves a run of user records that grew after it was sent; its
   tail names only the run's first records. Hashing whole runs only leaves
   those unresolved (10 requests in the scan, 2.1.300–2.1.302, one per file);
   with leading parts, every tail hash in the scan resolves within its own
   file.
4. **The body** is
   `{...params, system: shape.system, tools: shape.tools, messages}`, with
   each `cacheControl` value set as `cache_control` on the object at its
   `path`.
5. **`requestDigest`** is the hash of that body, `safeguards` included where
   `params` has it, string content rewritten as in step 2. It reproduces the
   digest of every request in the scan: 9,434 main-thread and 18,020 sub-agent.

#### What the logs drop compared with the wire

From the 15 requests that both a log and a Recording hold (all 2.1.305), the
rebuilt body equals the body sent except:

- the wire's first system block, the `x-anthropic-billing-header…` line, is not
  in the shape;
- `metadata` and `stream` are not recorded;
- `safeguards` (the safety classifier's context per the 2.1.304 changelog, not
  part of what the model saw) is sent but, from 2.1.304, not recorded. On
  2.1.300 it is on 2,644 of 2,689 requests, on 2.1.301–2.1.303 on all of them,
  on 2.1.304+ on none. It is 17.8% of all 2.1.300+ log bytes on its own;
- `params.betas` is not a body field (no recorded body has one): betas travel
  in the `anthropic-beta` header.

#### GOTCHA — a request can live in another session's file

A resumed or forked session's assistant records can point at an `api-request`
that only exists in the file it came from. Of the distinct `requestRef`s per
file, 610 of 9,490 on the main thread (6.4%) and 20 of 17,801 in sub-agents
point only to another file. 111 request `id`s appear in more than one file,
each a copy of one request: the same `requestDigest`, `base`, `keep`, `tail`
and `params` in every file (all 111 are Sub-agent transcripts copied into a
forked session's folder). Index requests across files, not per file: the app
resolves a Turn's `requestRef` in its own file first, then in any other
(below, "How they are stored").

**A `requestRef` can point to no file at all**, so a Turn's request is not
always buildable: 15 in the scan (2.1.300–2.1.304; 9 main-thread, 6
sub-agent). The 9 main-thread ones all sit before their file's first
`api-request`, where a resumed session's copied history goes; the request
they name is on disk nowhere. Show such a Turn without What was sent.

#### How they are stored

Refresh reads the `api-request`, `api-request-shape` and `api-request-blob`
records of every file of a Conversation, main thread and sub-agents
(`parseSessionLines`, `src/core/parse.ts`).

- **`api_request`**: one row per `api-request` record, whether or not a
  Turn answered it, with its file's Agent and its place in that file. A
  Failed attempt (Retries, below) also names the Turn that owns it, in
  `failed_attempt_of_message_id`. It keeps `base`, `keep`, `tail`, `params`
  **without `safeguards`**, `cacheControl`, `querySource`, `requestDigest` and
  `timestamp`, and the hashes of its system prompt and tool set.
- **A Turn's request** is named on its `message` row, `api_request_id`, beside
  its `requestRef` (`request_ref`): several Turns can name one request — its
  own file's and their copies in resumed and forked sessions. As each file is
  written, its Turns get the request of that file their `requestRef` names
  (of several, the latest in file order). At the end of the Refresh, every
  Turn of the database still without one gets the request of another file:
  of several files, the one of the Conversation with the smallest
  `source_path` (plain lexicographic order), its Main thread before its
  Sub-agents and these by agent id, then the latest in file order. Only ids
  are read, through the database, so a Turn of a Conversation the Refresh
  skipped is linked too, and one whose request's Conversation was re-parsed
  or deleted is linked again, or left without, as a cold Refresh would. A
  Turn linked to another file's request keeps it when a smaller-path file
  holding the same request appears later; a cold Refresh would pick that one
  — a known limit, harmless while the copies are identical. A `requestRef`
  that names no file leaves the Turn without What was sent.
- **`system_prompt`, `tool_set`**: each shape's `system` and `tools`, stored
  once as logged (key order kept) under the sha256 hex of their canonical JSON
  (`src/core/canonical-json.ts`), not under the per-file `shapeHash`, which
  names a pair. Two logs spelling one system prompt or tool set in two key
  orders store its smallest spelling, so the stored text never depends on
  parse order. A Refresh deletes those no request references any more.
- **`sent_message`**: each message a tail of the file names that the file can
  rebuild (step 2), under that hash, as logged (key order and a string
  `content` kept), the smallest spelling winning as above. A blob is stored
  under the `hash` it is logged with; a message rebuilt from the records,
  under the hash computed as step 2 says. Only a file with request records
  hashes its records, and only the messages some tail of the file names are
  kept, whether the blob comes before or after its request. A tail hash the
  file cannot resolve is not stored; a request naming another file's message
  finds it only if that file stored it. A Refresh deletes the messages no tail
  names any more. Beside each message, the pieces of Injected context its
  file's attachments name in it (below, "How the app names the pieces"): each
  one's content block, span and attachment type, and the files of an
  `instructions` one; the label is chosen when read. They travel with the
  message's spelling; of one spelling, a labelled copy beats an unlabelled
  one, so the first file to store a message does not decide its pieces.

A request's message list is never stored whole: it is rebuilt when read, by
walking the `base` chain over the requests of its file (step 1), and a
message the database does not hold, or a position a base outside the file
leaves unknown, is shown missing at its place and counted.

What was sent for a Turn compares its request with the latest earlier request
of the same file that a Turn answered, so an unanswered request retried since
is never the baseline. For a request found in another file, that is the other
file's. When the file holds no such request — the first request of a resumed
session's own file — the baseline is the request in another file of the latest
earlier Turn of the same Agent, in transcript order, that has one: the copied
history's last, so the comparison shows what changed on resume. A request of
the file itself found that way is later than this one (its Turn logged first),
so none of them is ever the baseline. Its new
messages start after the longest prefix of message hashes the two share, each
side's rebuilt from its own file; a position whose hash is unknown never
matches.
`cache_control` is set at every path, `["system", i]` and
`["messages", i, "content", j]`, before the missing messages are left out of
the raw body.

#### Retries

A request no `assistant` record points to, followed by one with the same
`requestDigest` whose `base` is that request, is a retry of it. The scan found
381 such chains: 379 of one retry, one of three, one of twelve, each ending in
a request a Turn answers. The logs record no status or error for the failed
ones. 16 more unanswered requests have no retry; half of them are the last
request of their file.

The Refresh models it: every request of a chain but its last is a Failed
attempt of the Turn that answers the last, which its row names
(`failed_attempt_of_message_id`). A chain no Turn answers, and an unanswered
request whose next request of the file sends something else (a user
interruption), belong to no Turn; a `requestDigest` missing on either side
never matches. The time an attempt lost, from its `timestamp` to the next
request's (the failure plus the backoff), is worked out when read. No attempt
counts toward Cost. A Turn's Failed attempts are its request's — those owned
by the Turn of the request's own file — so a Turn copied into a resumed
session shows them too.

#### Sizes

On 2.1.300+ files, request records are 19.2% of log bytes (`safeguards` makes
up 17.8 of those points), blobs 20.2% (about 770 MB; 690 MB of it user messages
with tool results), shapes 1.5%. The distinct blob messages across all files
come to about 720 MB.

### `cost-state`

Main files only: Claude Code's own running totals for the process —
`totalCostUSD`, `totalAPIDuration`, `totalAPIDurationWithoutRetries`,
`totalToolDuration`, `totalDuration`, `startTime`, `totalLinesAdded`,
`totalLinesRemoved`, `hasUnknownModelCost`, and per model `modelUsage`
(`inputTokens`, `outputTokens`, `cacheReadInputTokens`,
`cacheCreationInputTokens`, `webSearchRequests`, `costUSD`, …). It is per
process, not per Conversation.

### Attachments with `rendered` text (2.1.266+)

An injected-context `attachment` record carries, at its top level (next to
`attachment`, not inside it), `rendered: [{content}]` — the text, as the model
saw it — and from 2.1.285 `renderedRole`, `"system"` or `"user"`. Kinds with
`rendered`, most frequent first (scan counts):

- `total_tokens_reminder` (62,770), `bash_output_audience_note` (8,763),
  `output_style` (3,747), `environment` (3,336), `queued_command` (2,125, §8),
  `date` (2,034), `model` (1,996), `instructions` (1,996: CLAUDE.md / AGENTS.md
  files), `session_context` (1,976), `skill_listing` (1,930),
  `deferred_tools_delta` (1,884), `agent_listing_delta` (1,831),
  `task_reminder` (1,742), `auto_mode` (1,591), `edited_text_file` (1,448),
  `mcp_instructions_delta` (1,263), `remote_session_change` (828),
  `silent_turn_reminder` (718);
- rarer: `output_style_instructions`, `skill_mention`, `read_truncation_notice`,
  `sandbox_instructions`, `nested_memory`, `peer_mention`, `file`,
  `directory`, `fork_briefing`, `hook_success`.

`file`, `directory` and `hook_success` have `rendered` only sometimes; other
kinds never do (`deferred_tools_record`, `batching_reminder_sent`,
`prompt_snapshot`, `credential_org`, `command_permissions`, …).

**Role and wrapping.** From 2.1.285 the role is fixed per kind: `user` for
`instructions`, `session_context` and `remote_session_change`, `system` for
every other kind. The logged text is wrapped in
`<system-reminder>…</system-reminder>` (except some `queued_command` text,
already in its §8 wrapper), whatever the role:

- **`system`** text is sent **unwrapped**, in a `role: "system"` message
  (a blob), sometimes sharing it with other attachments' text;
- **`user`** text is sent **verbatim**, wrapper included, inside a user
  message.

**A fused system block.** A `role: "system"` message is one text block, and
that block often joins **several** attachments' unwrapped texts with a blank
line (`\n\n`), in log order: of 3,596 such blocks in the 80 most recently
modified files, 2,916 equal exactly one attachment's text, 667 join several —
the first Turn's carries the environment, model, deferred tools, agent list,
MCP instructions, skill list, auto mode and date in one block — and 12 match
none. A user-role attachment is always exactly one text block equal to its
rendered text (207 of 207).

**How the app names the pieces.** While a file is read, each rendered text of
an attachment with a `renderedRole` maps to its attachment type, under both
its logged and its unwrapped form, so it matches whatever role it went out
under. A sent text block (not the assistant's) equal to one is one piece of
that kind; any other block of a **system** message holds each rendered text
found in it, in order and not overlapping. A user's text block is never
split, so a Prompt quoting an injected text stays a Prompt: no user block has
needed it — of 187 `queued_command` texts in the 120 latest logs, 52 are a
whole user block, 133 sit inside a fused system block, 2 nowhere and none
inside a larger user block. What a block holds around its matched pieces, and a block
matching nothing, keeps the generic label. The text alone identifies the
kind: equal texts (the Bash output note, repeated token reminders) are of one
kind, so no `parentUuid` chain needs walking, and an attachment logged after
the message that sent it still names it.

#### GOTCHA — no `renderedRole` before 2.1.285

Every attachment with `rendered` from 2.1.266 to 2.1.284 (about 28,000 in the
scan) lacks `renderedRole`. Those versions write no request
records, and no Recording covers them, so how that text was sent is unknown:
the per-kind roles above are a guess for them, not a fact.

`prompt_snapshot` (system prompt and tools) and `deferred_tools_record` (the
definitions of deferred tools loaded with ToolSearch) also exist from 2.1.266,
but are no substitute for request records: 1,931 of the 1,974 files with
snapshots have exactly two, and none of the 1,443 deferred tools loaded later
appears in any snapshot.

### New fields

On `assistant` records (first version seen):

| Field                | Since   | What it is                                                                                                                                                         |
| -------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `requestRef`         | 2.1.300 | The `api-request` `id` (above). On every 2.1.300+ assistant record but two `<synthetic>` ones.                                                                     |
| `requestedModel`     | 2.1.295 | The model asked for. Equal to `message.model` on all 92,052 records but 51, whose `message.model` is the placeholder `fake`.                                       |
| `perTurnEffort`      | 2.1.267 | `high`, `medium` or `null`. Usually equal to the older `effort` field (138k of 148k records).                                                                      |
| `thinkingDisplay`    | 2.1.296 | `updates` or `omitted`; see §3, "Thinking".                                                                                                                        |
| `thinkingDurationMs` | 2.1.287 | Time spent thinking; see §3, "Thinking".                                                                                                                           |
| `apiBlockIndex`      | 2.1.258 | Index of this record's one content block within the API response; a message's records almost always count 0, 1, 2…                                                 |
| `wireToolInputs`     | 2.1.272 | `{<tool_use id>: input}` for this record's tool calls: the input as sent. On every tool-call record since, not only when it differs (it differs on about a third). |

`advisorModel`, `wireIngestContext` and `serverClassifierRequest` also appear
from 2.1.272–2.1.278.

On `user` records: `turnOrigin` (2.1.278: `human`, `peer`,
`task_notification`, `system`, `sdk`), `turnPosition` (2.1.284:
`{promptIndex, turnIndex}`), `promptSource` (`typed`, `system`, `queued`,
`sdk`, `suggestion_accepted`) and `permissionDecision` (2.1.294:
`{decision, source, reasonType?}`).

## 10. Continuations: a resumed or forked session copies its parent, a forked Sub-agent its spawner

Resuming a session (`--resume`) or forking it starts a new `<sessionId>.jsonl`
that **copies** the parent's records up to the resume point: same `uuid`s,
same `parentUuid` chain, same timestamps. Then come the new session's own
records. Nothing points back into the parent: the first own Message's
`parentUuid` never names the last copied one, and of the 65 first Messages
that carry a `parentUuid`, none names a Message of another session. Measured
on 2,722 Main-thread files (2.1.143–2.1.309), October 2026:

- 151 files share their first Message's `uuid` with another file, in 76
  groups: 73 pairs, one chain of three, and two files whose other holder
  starts elsewhere.
- The copied records carry the **child's** `sessionId` (7,560 of 7,585), so no
  field marks a record as a copy. Their `cwd` is mostly the parent's (3,908
  records), sometimes the child's (1,104).
- The copy holds only the chain records (`user`, `assistant`, `attachment`,
  `system`), contiguous. The original interleaves other records (`api-request`,
  `mode`, `last-prompt`…) in the same stretch: 54 of 55 pairs tell apart this
  way. A copy usually opens with an `ai-title` (67 of 71) and an `agent-name`,
  an original with `mode`/`permission-mode`.
- The copy's only title is the parent's: on resume Claude Code re-appends the
  current title into the new file, and all 71 named children hold one distinct
  `ai-title` value, the parent's. So a continuation shows its parent's title,
  in Claude Code's `/resume` picker and here alike; the family tree is what
  tells the sittings apart.
- Since 2.1.296 the parent's file ends with a `continued-in` record naming the
  child: `{"type":"continued-in","sessionId":<parent>,"continuedInSessionId":<child>}`.
  A session resumed twice carries two. 71 files hold one.
- In the 61 pairs a record names, with both files on disk and the child
  holding Messages: in 47 the parent's Messages are a strict subset of the
  child's (the parent stopped where it was resumed); in 14 the parent holds
  one more, an in-flight Turn the copy left out. A child is never a subset of
  its parent. 10 more named children hold no Message (resumed, then quit).
- Sub-agent transcripts are not copied: the child's `subagents/agent-<id>.jsonl`
  is a symlink to the parent's file (6 pairs). Discovery reads regular files
  only, so the app does not ingest these.

### Forked Sub-agents copy their spawning Agent

A Sub-agent that calls the `Agent` tool with `"subagent_type": "fork"` starts a
fork whose new `agent-<id>.jsonl` **copies** the spawning Sub-agent's records
up to the spawn: same `uuid`s, `parentUuid` chain and timestamps, but the
fork's own `agentId`. Then come a re-written spawn `assistant` record (a new
`uuid`, holding only this fork's `Agent` call), a synthetic `tool_result`
("Fork started — processing in background", then a `<fork-boilerplate>` text),
and the fork's own work. Measured on 2,521 Sub-agent transcripts (2.1.218–2.1.309),
October 2026:

- 11 forks of 3 spawning Sub-agents, in 3 Conversations (one spawner forked 5
  times, another 5, a third once; 2.1.278–2.1.300). Each fork's leading run
  of 9, 10 or 25 Messages is its spawner's — 184 Messages in all — and no
  other Sub-agent's first Message is held by another Agent of its
  Conversation.
- The spawner carries on after the spawn, and so does each fork: every pair,
  spawner and fork or two sibling forks, is a near-fork, each holding a
  Message the other lacks. Containment would tell no original.
- The spawn link tells it: the fork's meta file names the spawner's `Agent`
  call, which the spawner owns — the fork's re-written copy of it never makes
  the fork its own spawner — so the fork is stored under its spawner
  (`agent.parent_agent_id`, `spawned_by_message_id` in the spawner), as any
  Sub-agent is (§4). Sibling forks spawned by one Message share that
  `spawned_by` Message. Claude Code also writes the relation into the meta
  file as `"isFork": true` and `"parentAgentId"`; the app does not read those
  two keys (§4).
- A fork of a fork copies its spawning fork's records, which begin with that
  fork's own copy: the direct spawner holds the whole copied run.
- The re-written spawn record is the spawner's spawning Turn under a new
  `uuid`: same `message.id`, `requestId` and `usage` (one fork's holds the
  spawner's 1,199 output tokens). Matched by its `message.id`, as every Turn
  is, it is an occurrence of the spawner's Turn, which the spawner owns: it is
  a Copied Message of the fork, and counts once, in the spawner — 11 Turns on
  this machine that each fork counted again before.
- A fork the **Main thread** spawns copies none of its records: its transcript
  opens with a `fork-context-ref` record (`parentSessionId`, `parentLastUuid`,
  `contextLength`) in place of them (5 files, 2.1.218–2.1.280), then the
  re-written spawn record, an occurrence of the Main thread's spawning Turn —
  a Copied Message, as a Sub-agent fork's is.

### The rule

**Explicit records decide; content matching is frozen (ADR-0011).** Where
Claude Code writes the relation down — `continued-in`, `fork-context-ref`, the
meta file's `toolUseId` and `agentType` (§4) — that record decides. The
prefix-containment rule below stays only for logs before 2.1.296, which carry
no `continued-in` record, and gains no cases: a new log shape is met by reading
the record Claude Code writes for it, not by a new matching rule. Which Messages
are copies is decided by ownership, below, never by matching a copy against
its original.

A Conversation's **parent** is the Conversation whose `continued-in` record
names it — of several, the smallest `source_path`. The record wins even when
the child holds none of the parent's Messages (a compacted copy, or a child
that quit before its first Message).

Without a record (logs before 2.1.296), the parent is a Conversation holding
the child's first Message whose Main-thread Messages the child's Main thread
holds **all** of, a record of the child naming it excepted. Two holding exactly
the same Messages — a resume that never continued, where nothing tells the
original from the copy — take the smallest `source_path` as the original, as
the cross-file request link of §9 does. Of several candidates, the parent is
the one sharing the longest leading run of Messages with the child (a
grandchild copies its parent's own Messages, not only the grandparent's);
ties go to the smallest `source_path`. A near-fork — each holds a Message the
other lacks, and no record tells — stays unlinked rather than guessed: 6 of
the 14 unnamed pairs on this machine.

**One Agent owns each Message**, however many files hold it. A Turn is
matched across the logs by its `message.id`, any other Message by its `uuid`;
a Turn without a `requestId` (a mock API's) and a record without a `uuid` are
their own file's. Of the Agents holding one, every one with another holder
among its ancestors is dropped — the Conversations of its `continued_from`
chain, and in its own Conversation the Agents that spawned it, at any depth —
and of the rest the one with the smallest log path (`agent.source_path`)
owns it; its only holder owns it, copy or not. A **Copied Message** is every
other occurrence (Glossary, "Copied Message"): a continuation's copy of its
parent's history, a Sub-agent transcript a continuation holds as a regular
file, a fork's copy of its spawner's records and its re-written spawn record,
a fork of a fork's copy — owned by the root spawner, not the fork it copied.
An original's Messages, held by its copies, are its own; a copy whose original
is gone owns that history, recorded nowhere else; and of two holders with no
lineage between them — a near-fork, or two Agents of one Conversation with no
spawn link — the one of the smallest log path owns what they share.

### How they are stored

- **`continued_in`**: one row per `continued-in` record of a Conversation's
  Main-thread file, the session it names.
- **`conversation.continued_from_conversation_id`**: the parent, by the rule.
- **`turn`**: one row per Turn (§3, GOTCHA 1), however many files hold it: its
  owning occurrence's `message` row, that occurrence's Agent and Conversation,
  each usage bucket's highest value over every occurrence, and the owner's
  model and timestamp. Cost and every token total sum it, so a copier keeps
  the spend of the history it owns and no other. `message.request_id` keeps
  the record's `requestId`, which makes the Turn's identity global.
- **`message.copied_from_message_id`**: on a Copied Message, the owning
  occurrence's row; NULL on the owner and on a Message only its file can own.
  For a Turn it is written from the same decision as its `turn` row.

The Refresh decides the parent in its links pass, from the database alone, so a
skipped parent counts and the outcome is the same in a cold Refresh and an
incremental one. It decides it for every Conversation it wrote, every one
holding a written Conversation's first Message (every copy of a session, and
every session it copies, holds that Message), every one a written
Conversation's records name or that continues from it, and the continuations
of every Conversation it deleted. Like the written ones, those continuations
stay unstamped until the pass commits, so an interrupted run leaves them
re-parseable. A written Conversation with no copy costs a few indexed lookups.

Once those links are final, the same pass decides the owner of every Message
held by a Conversation it decided them for, and of every Message an Agent it
deleted held, read before the delete: that set is collected, never found by
scanning the database. Each is resolved against all its stored occurrences:
a Turn's `turn` row is written, and each occurrence names its owner. An Agent
it deletes, whether its file is gone or written again, leaves the other
Conversations holding one of its Messages unstamped until the pass commits,
as continuations are.

A fork's Copied Messages rest on its spawner, which the same pass resolves
from stored rows before it decides any owner (§4, "How it is stored"), so a
fork's file that appears while its spawner's is unchanged reads no other file.
