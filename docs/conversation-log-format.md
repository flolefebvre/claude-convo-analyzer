# Claude Code conversation log format (reference)

Empirically reverse-engineered from the logs on this machine (Claude Code
versions ~2.1.143–2.1.306, June–October 2026: §1–§7 were mapped on
2.1.145–2.1.185, §8 and §9 on later versions). This is a **reference map** so future
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

| `type`                  | ~count | What it is                                                                                                                                                                                                                                              | Modeled?                                 |
| ----------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------- |
| `assistant`             | 11808  | An assistant turn (see §3). Carries `message.usage`, `message.model`, content blocks, attribution.                                                                                                                                                      | **Yes** → `message` (+ `tool_call`)      |
| `user`                  | 7251   | A user message OR a `tool_result` carrier (see §4).                                                                                                                                                                                                     | **Yes** → `message` / feeds `tool_call`  |
| `attachment`            | 3105   | A dict `attachment` tied to a message via `parentUuid`: pasted content (images, files), a `queued_command` — a message delivered while the agent was working (§8) — or, since 2.1.266, injected context with the text the model saw in `rendered` (§9). | **Partly** → `queued_command` only (§8)  |
| `ai-title`              | 1252   | `aiTitle`: AI-generated conversation title.                                                                                                                                                                                                             | **Yes** → `conversation.title`           |
| `mode`                  | 1016   | `mode` (e.g. `normal`) state marker.                                                                                                                                                                                                                    | **No** (low value)                       |
| `permission-mode`       | 1013   | `permissionMode` (e.g. `default`, `plan`) state marker. Also present per-turn on `user` records.                                                                                                                                                        | **Partly** (per-turn field on `message`) |
| `last-prompt`           | 992    | `lastPrompt` text + `leafUuid`. Duplicates content already in `user` records.                                                                                                                                                                           | **No** (redundant)                       |
| `file-history-snapshot` | 798    | `snapshot` dict = file contents for undo/checkpoint, keyed to a `messageId`. Lets you reconstruct which files changed + diffs.                                                                                                                          | **No** (large; see §6)                   |
| `queue-operation`       | 632    | Queued user input (`operation: enqueue`, `content`).                                                                                                                                                                                                    | **No**                                   |
| `system`                | 522    | Meta events by `subtype`: `turn_duration` (`durationMs`, `messageCount`), compaction (`compactMetadata`), API retries (`retryAttempt`, `maxRetries`, `retryInMs`), errors.                                                                              | **Partly** → `turn_duration` table only  |
| `pr-link`               | 78     | `prNumber`, `prUrl`, `prRepository` — a PR surfaced in the session.                                                                                                                                                                                     | **Yes** → `pr_link`                      |
| `bridge-session`        | 58     | `bridgeSessionId` — links a CLI session to a web/bridge session.                                                                                                                                                                                        | **No**                                   |
| `agent-name`            | 50     | `agentName` — a name assigned to a (sub)agent session.                                                                                                                                                                                                  | **No**                                   |
| `agent-setting`         | 23     | `agentSetting` (e.g. `claude`).                                                                                                                                                                                                                         | **No**                                   |
| `worktree-state`        | 15     | `worktreeSession` dict — git worktree association.                                                                                                                                                                                                      | **No**                                   |
| `custom-title`          | 15     | `customTitle` — user-set conversation title.                                                                                                                                                                                                            | **Consider** (overrides `ai-title`)      |
| `api-request`           | §9     | One API request an Agent sent, since 2.1.300: its parameters, and pointers to its system prompt, tools and messages.                                                                                                                                    | **No** (§9)                              |
| `api-request-shape`     | §9     | The system prompt and tools of `api-request`s, stored once under `shapeHash`.                                                                                                                                                                           | **No** (§9)                              |
| `api-request-blob`      | §9     | One message of `api-request`s, stored once under its hash.                                                                                                                                                                                              | **No** (§9)                              |
| `cost-state`            | §9     | Claude Code's own per-process cost and usage totals.                                                                                                                                                                                                    | **No** (§9)                              |

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

- **Thinking / reasoning text — rarely available, and only a summary.**
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

- **File-history snapshots** (`file-history-snapshot.snapshot`): full file
  contents per checkpoint, keyed by `messageId`. This is how you'd reconstruct
  _which files changed and their diffs_. Skipped for size/complexity.
- **Attachments** (`attachment` records) other than `queued_command`: pasted
  images/files, and the injected context of §9. Skipped (large/binary).
  `queued_command` attachments ARE modeled (§8).
- **Request records** (`api-request`, `-shape`, `-blob`) and `cost-state`
  (§9).
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

## 9. Request records and rendered context (2.1.266+)

Since **2.1.300** every log file — main thread and sub-agent transcript alike —
records each API request its Agent sent: the system prompt, the tools, every
message and the parameters, enough to rebuild the request body. Since
**2.1.266** the injected-context attachments carry the text the model saw. The
numbers below come from an October 2026 scan of this machine: 4,942 files, 750
of them with 2.1.300+ records (330 main Conversations), about 27,000
`api-request` records (9,200 main-thread, 17,700 sub-agent).

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
   (`{role: "assistant", content}`); or a run of consecutive `user` records (no
   `assistant` record between them), concatenated the same way
   (`{role: "user", content}`), a string `content` counting as one text block.
   **The hash** is the sha256 hex of the message's canonical JSON — keys
   sorted, no whitespace, non-ASCII kept as is — **with a string `content`
   rewritten as one text block, `[{type: "text", text}]`, first.** The blob
   carries the string itself (747 blobs in the scan: 722 `system`, 25 `user`),
   as does the wire (seen on the 20 string `system` messages Recordings
   hold), so a string-content message never matches its hash as stored:
   rewrite it to hash, keep the string to show what was sent. The same rule
   holds for `requestDigest` (step 4), which only reproduces with it.
3. **Resolution can fail.** In the scan, 10 requests (2.1.300–2.1.302, 7
   main-thread and 3 sub-agent, one per file) each have one tail hash that no
   file resolves. All 10 are requests no Turn answers; the missing message
   always sits right after an assistant message and before a `system` one,
   where the user message carrying tool results goes, and no later request
   reuses it. Treat such a request as unbuildable, not the file as broken.
4. **The body** is
   `{...params, system: shape.system, tools: shape.tools, messages}`, with
   each `cacheControl` value set as `cache_control` on the object at its
   `path`.
5. **`requestDigest`** is the hash of that body, `safeguards` included where
   `params` has it, string content rewritten as in step 2. It reproduces the
   digest of every request whose messages all resolve: 9,254 of 9,261
   main-thread and 17,865 of 17,868 sub-agent requests (the rest are the 10 of
   step 3).

#### What the logs drop compared with the wire

From the 15 requests that both a log and a Recording hold (all 2.1.305), the
rebuilt body equals the body sent except:

- the wire's first system block, the `x-anthropic-billing-header…` line, is not
  in the shape;
- `metadata` and `stream` are not recorded;
- `safeguards` (the safety classifier's context per the 2.1.304 changelog, not
  part of what the model saw) is sent but, from 2.1.304, not recorded. On 2.1.300 it is on 2,644 of
  2,689 requests, on 2.1.301–2.1.303 on all of them, on 2.1.304+ on none. It
  is 17.8% of all 2.1.300+ log bytes on its own;
- `params.betas` is not a body field (no recorded body has one): betas travel
  in the `anthropic-beta` header.

#### GOTCHA — a request can live in another session's file

A resumed or forked session's assistant records can point at an `api-request`
that only exists in the file it came from. Of the distinct `requestRef`s per
file, 610 of 9,490 on the main thread (6.4%) and 20 of 17,801 in sub-agents
point only to another file; 15 point to no file at all. 111 request `id`s
appear in more than one file. Index requests across files, not per file.

#### Retries

A request no `assistant` record points to, followed by one with the same
`requestDigest` whose `base` is that request, is a retry of it. The scan found
381 such chains: 379 of one retry, one of three, one of twelve, each ending in
a request a Turn answers. The logs record no status or error for the failed
ones. 16 more unanswered requests have no retry; half of them are the last
request of their file.

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
every other kind. The logged text is wrapped in `<system-reminder>…</system-reminder>`
(except some `queued_command` text, already in its §8 wrapper), whatever the
role:

- **`system`** text is sent **unwrapped**, in a `role: "system"` message
  (a blob), sometimes sharing it with other attachments' text;
- **`user`** text is sent **verbatim**, wrapper included, inside a user
  message.

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
| `thinkingDisplay`    | 2.1.296 | `updates` or `omitted`; see §6.                                                                                                                                    |
| `thinkingDurationMs` | 2.1.287 | Time spent thinking.                                                                                                                                               |
| `apiBlockIndex`      | 2.1.258 | Index of this record's one content block within the API response; a message's records almost always count 0, 1, 2…                                                 |
| `wireToolInputs`     | 2.1.272 | `{<tool_use id>: input}` for this record's tool calls: the input as sent. On every tool-call record since, not only when it differs (it differs on about a third). |

`advisorModel`, `wireIngestContext` and `serverClassifierRequest` also appear
from 2.1.272–2.1.278.

On `user` records: `turnOrigin` (2.1.278: `human`, `peer`,
`task_notification`, `system`, `sdk`), `turnPosition` (2.1.284:
`{promptIndex, turnIndex}`), `promptSource` (`typed`, `system`, `queued`,
`sdk`, `suggestion_accepted`) and `permissionDecision` (2.1.294:
`{decision, source, reasonType?}`).
