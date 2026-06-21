# Context — Claude Conversation Analyzer

A local-only app that reads the Claude Code conversation logs stored on this
machine, parses them deterministically into a SQLite database, and presents
analysis (starting with per-conversation token usage and cost).

This file is the **glossary** — the ubiquitous language for the domain. It
contains no implementation details. Architectural decisions live in
`docs/adr/`.

## Glossary

### Project
A working directory in which Claude Code was used. On disk it is one folder
under `~/.claude/projects/`, named after the directory path with `/` replaced
by `-` (e.g. `-Users-prezbar-Documents-dev-pvm2-0` ⇒ `/Users/prezbar/Documents/dev/pvm2.0`).
A Project contains one or more Conversations. Referred to as the **Folder** in
the UI. Project identity is **one project per on-disk folder** (the launch
directory); a Conversation's exact project path is read from its records' `cwd`.
Within-session `cwd` drift (the agent `cd`-ing into a subdirectory) does not
change the Project. Git worktrees launch in their own folder and therefore
appear as **separate** Projects.

### Conversation (Session)
One continuous Claude Code session. On disk it is a single `<sessionId>.jsonl`
file inside a Project folder. Each line is a typed Record. A Conversation is the
unit shown as one row in the conversation list. Its human-readable name comes
from an `ai-title` Record.

### Record
One line of a Conversation's JSONL file, identified by a `type` (e.g.
`assistant`, `user`, `ai-title`, `system`). Only some Record types carry token
usage.

### Agent
An autonomous Claude execution within a Conversation. There are two kinds:

- **Main thread** (root agent): the primary conversation the user drives
  directly. Its work appears as `assistant` Records in the Conversation file.
- **Sub-agent**: an agent spawned by the Main thread via the `Agent` tool
  (e.g. an `Explore` or `Plan` agent). A sub-agent runs in its own context and
  has its **own full transcript file** at
  `<sessionId>/subagents/agent-<agentId>.jsonl`, with the same per-turn
  `assistant` Records as a Main thread (marked `isSidechain: true`). The
  spawning `Agent` call also mirrors the sub-agent's *aggregated* token ledger
  into its tool result (`toolUseResult`) — the same tokens as the transcript,
  so the transcript is the source of truth and the aggregate is only a
  cross-check. A sub-agent may resolve to a different (often cheaper) model than
  the Main thread.

Main thread and Sub-agent are the **same kind of thing** — a transcript of
Claude doing work — differing only by location and lineage. They are parsed
identically.

### Resolved model
The concrete Anthropic model a unit of work actually ran on (e.g.
`claude-opus-4-8`, `claude-haiku-4-5`). The Main thread reports it per turn as
`message.model`; a sub-agent reports it once as `resolvedModel`. Some Records
carry coarse aliases (`opus`) or `<synthetic>` placeholders that must be
normalized.

### Token types
Usage is split into distinct types, each priced differently:

- **Input** — fresh prompt tokens.
- **Output** — generated tokens.
- **Cache creation** — tokens written to the prompt cache, sub-split into
  `5m` and `1h` ephemeral tiers (different prices).
- **Cache read** — tokens served from the prompt cache.

### Turn
One model request/response within the Main thread. Usage is reported
**per turn**, so a Conversation's Main-thread usage is the sum across turns.
Multiple Records can describe the same turn (one per content block) and repeat
the same usage — turns are therefore deduplicated by their message id before
summing.

### Message
One logical message in a Conversation — a user message or an assistant turn.
The unit of the `message` table: one row each, deduplicated by message id for
assistant turns. An assistant Message carries token usage and Attribution; a
user Message has neither (its tokens are billed into the following assistant
Turn). Optionally carries the message `text`.

### Attribution
Per-turn labels on an assistant Message naming what drove it: `attribution_skill`
(e.g. `tdd`, `orchestrate`), `attribution_agent` (e.g. `Explore`),
`attribution_plugin`, `attribution_mcp_server`. Because Attribution and usage
sit on the same Message, **per-skill and per-agent-type token cost are exact**
(unlike per-individual-Tool-call cost).

### Tool call
A single invocation of a tool by an Agent, recorded as a `tool_use` content
block in a turn and paired with a `tool_result`. Carries the tool `name` (e.g.
`Bash`, `Read`, `Skill`, `Agent`) and a tool-specific `input` (e.g. Bash's
`command`, Skill's `skill` name). A Tool call belongs to exactly one Turn of one
Agent.

### Skill invocation
A Tool call with `name = Skill`; its `input.skill` names the skill (possibly
`plugin:skill`). This is the canonical signal that a skill ran. (User-typed
slash commands like `/config` appear separately as `command-name` markers in
user Records and are built-in commands, not skills.)

### Tool-call token cost
Token usage is recorded only at Turn grain and per sub-agent — **never per
individual Tool call**. Therefore:

- An `Agent` Tool call has an **exact** token cost: the spawned sub-agent's own
  usage.
- Every other Tool call (Bash, Read, Skill, …) has **no exact** token cost. Its
  cost is entangled in its Turn's `output_tokens` (generating the call) and the
  next Turn's input/cache tokens (consuming the result), and a Turn may contain
  several Tool calls. Such costs can only be attributed at Turn grain or
  approximated by tool-result size.

### Cost
The hypothetical price of a Conversation had it run on the Claude API, computed
from its token usage and a per-model, per-token-type price list. Costs are
attributed per Resolved model, so Main-thread and sub-agent costs can differ
within one Conversation.

### Refresh
The user-triggered action that re-reads the conversation logs from disk and
updates the local SQLite database, so the UI does not re-parse on every view.
