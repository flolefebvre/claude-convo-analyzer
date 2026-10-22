# Glossary — Claude Conversation Analyzer

A local-only app that reads the Claude Code conversation logs stored on this
machine, parses them deterministically into a SQLite database, and presents
analysis (starting with per-conversation token usage and cost).

This file is the **glossary** — the ubiquitous language for the domain. It
contains no implementation details. Architectural decisions live in
`docs/adr/`.

## Glossary

### Project

A working directory in which Claude Code was used. A Project contains one or
more Conversations, and is identified by its **path**: the directory its
Conversations run in, as their records' `cwd` states it — never the shell's
directory, and never a path guessed from the log folder's name while any
Conversation filed beside it states its `cwd`.

Within-session `cwd` drift (the agent `cd`-ing into a subdirectory) does not
change the Project. Switching into a git worktree does: a Conversation that
started in a repo and moved into one of its worktrees belongs to the worktree,
where it did its work.

On disk, Claude Code files each Conversation in a folder under
`~/.claude/projects/` named after that directory with `/` replaced by `-`
(e.g. `-Users-me-Documents-dev-pvm2-0` ⇒ `/Users/me/Documents/dev/pvm2.0`).
That name is lossy (a real `-` or `.` reads the same as `/`), so it is a filing
detail, not the Project's identity.

The **friendly name** of a Project is the last segment of its path (e.g.
`pvm2.0`), used as the human label in the UI; the full path is shown alongside
it.

### Folder

A node of the **folder tree** the UI navigates by: a directory that is a
Project's path or contains one. A repo's git worktrees and a scratch directory's
per-session subdirectories are therefore Folders under it, not peers of it.
Selecting a Folder **scopes** every view to the Conversations of all the
Projects at or below it; its cost is theirs summed. A Folder that is itself a
Project and also has sub-Folders can be narrowed to **this folder** — its own
Conversations only.
_Avoid_: using Folder for the on-disk log folder under `~/.claude/projects/`.

### Favorite

A Folder the user starred to keep at hand: it is listed under **Favorites** at
the top of the sidebar, in the user's order (favorited order, a new favorite
last, until the user moves one by its grip), and selects its scope like its tree
row. Favorites are kept by Folder path in the settings file, not in the
database, so neither a Refresh nor a database reset touches them. A favorite with
no Conversations at or below it stays kept but is not listed, until some exist
there again, back in its place between its neighbours.

### Conversation (Session)

One continuous Claude Code session. On disk it is a single `<sessionId>.jsonl`
file inside a log folder under `~/.claude/projects/`. Each line is a typed
Record. A Conversation is the unit shown as one row in the conversation list.
Its human-readable name comes from an `ai-title` Record.

### Continuation family

The set of Conversations that make up ONE piece of work spread over several
sittings. Resuming a session (`--resume`) or forking it starts a **new**
Conversation whose first Record points back into the previous one: that link is
the **continued-from** parent pointer. A Conversation can have several
continuations (forks), so the links form a **tree**; the **family** is the whole
connected component — walked in both directions, parents and continuations
alike. Its **cumulative total** is the sum of its members' Costs, and is a lower
bound whenever any member has unpriced usage.

A family is a _view_, never a merge: every member stays its own Conversation
row with its own Cost, so per-conversation totals and the overview aggregate are
unchanged by it (nothing is double-counted). Members can live in different
Projects — resuming from a git worktree launches in another directory.

### Record

One line of a Conversation's JSONL file, identified by a `type` (e.g.
`assistant`, `user`, `ai-title`, `system`). Only some Record types carry token
usage.

### Agent

An autonomous Claude execution within a Conversation. There are two kinds:

- **Main thread** (root agent): the primary conversation the user drives
  directly. Its work appears as `assistant` Records in the Conversation file.
- **Sub-agent**: an agent spawned by another Agent via the `Agent` tool
  (e.g. an `Explore` or `Plan` agent). The spawner is usually the Main thread,
  but a sub-agent can itself spawn sub-agents, so lineage nests to arbitrary
  depth. A sub-agent runs in its own context and has its **own full transcript
  file** at `<sessionId>/subagents/agent-<agentId>.jsonl`, with the same
  per-turn `assistant` Records as a Main thread (marked `isSidechain: true`) —
  including, when it spawns, its own `Agent` calls and spawn ledger, which is
  where a grandchild's parentage is recorded. The spawning `Agent` call also
  mirrors the sub-agent's _aggregated_ token ledger into its tool result
  (`toolUseResult`) — the same tokens as the transcript, so the transcript is
  the source of truth and the aggregate is only a cross-check. A sub-agent may
  resolve to a different (often cheaper) model than the Main thread.

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
summing. A Turn may carry its **thinking**: how long the model thought and,
sometimes, a short summary of it.

### Message

One logical message in a Conversation — a user message or an assistant turn.
The unit of the `message` table: one row each, deduplicated by message id for
assistant turns. An assistant Message carries token usage and Attribution; a
user Message has neither (its tokens are billed into the following assistant
Turn). Optionally carries the message `text`.

A user Message is one of five **kinds**, all sharing `role = user` in the log:

- **Prompt** — text that sets the Agent to work, with an **author**: the human
  (typed, or inserted on their behalf by a plugin), or the Agent that spawned
  this one. A Prompt the human authored is the only kind that represents the
  user speaking. A **Task prompt** is the one a spawner writes to hand work to
  a Sub-agent: its Agent call's `prompt` input, and the first Message of the
  Sub-agent's Transcript.
  _Avoid_: brief, delegation message, spawn prompt (for a Task prompt).
- **Inter-agent message** — text another Agent addressed to this one: a
  Sub-agent reporting to its spawner, the spawner steering a running Sub-agent,
  or another Conversation's agent reaching this one. Always has a **sender**.
  A Sub-agent's final report is its **hand-back**: a background Sub-agent's
  arrives as an Inter-agent message, a foreground one's as its Agent call's
  result.
  _Avoid_: agent message (also reads as the Agent's reply to the user), peer
  message.
- **Task notification** — an event announcing that a background task or
  Sub-agent stopped, with its status; machinery, not speech.
- **Tool-result carrier** — a record delivering a `tool_result` back to the
  Agent; machinery, not speech.
- **Meta** — machine-injected content (skill instructions, command output,
  system reminders), marked `isMeta` in the log.

A Prompt or Inter-agent message can arrive **while the Agent is working**, in
which case it lands mid-turn rather than between turns.

### Transcript

The ordered, message-by-message content of **one Agent**: its user and
assistant Messages with their Tool calls. Every Agent (Main thread or
Sub-agent) has exactly one Transcript. Distinct from the cost-aggregate
**detail panel** (`ConversationDetail`) shown in the conversation list — the
Transcript is _what was said and done_, not _what it cost_.

A long Transcript is read one **Transcript page** at a time: a fixed-size
window of its rendered Messages, in order. A page is only a view: what is said
about the Agent as a whole (its turn and Tool-call counts, its effort) always
describes the whole Transcript, never the page. A link to one Message opens the
page that holds it.

### Conversation export

A self-contained document of one Conversation, made to be read outside the app
by someone who doesn't have it: every Agent's whole Transcript, never one page
of it, with its Tool calls' bodies and its Costs, as the app shows them. It
leaves out what the app hides (Meta Messages) and What was sent, and it names
the user's home directory `~`; nothing else is scrubbed. Tool results stay as
stored, so a long one is still cut. A link that would lead back into the app
reads as plain text.
_Avoid_: dump, snapshot, archive.

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

In a Transcript a Tool call reads as a summary and a body. Its **summary** is
the one line it shows collapsed: its kind, name, a snippet of its input, its
result size and whether it failed. Its **body** is the full input and stored
result, shown once the reader opens it.

The body shows its input, and separately its result, as an ordered list of
**parts**, chosen by the tool's **view**: `facts` (key/value pairs), `markdown`
(one agent-written text, such as an Agent call's Task prompt) or `raw` (the
stored text, pretty-printed). A tool without a view, or a text its view can't
read, shows one raw part; any rendered part keeps a "Raw" toggle back to the
stored text.

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
within one Conversation. Claude Code's own background requests (naming the
session, suggestions, web summaries) never appear in the logs, so Cost leaves
them out.

### Refresh

The action that re-reads the conversation logs from disk and updates the local
SQLite database, so the UI does not re-parse on every view. The user triggers
it, Live does when the logs change, and the app does at startup when nothing is
stored yet or the stored data predates the parser.

At most one Refresh runs at a time. A click starts one, or joins the one already
running; it outlives the page that started it, and every open page sees its
**progress** (conversations done out of conversations to re-parse) and its
final summary. The app stays usable while it runs: pages show what is already
stored, the open page updates now and then as Conversations land, and once
more when the Refresh ends. A Refresh cannot
be cancelled; an interrupted one is safe, and the next one picks up what it
missed.

A **cold** Refresh is one with nothing stored yet, so every Conversation is
parsed. A Refresh right after the parser changes costs the same, since every
Conversation must be re-parsed.

### Live

A mode the user switches on in the app, off by default: while it is on, the app
watches the conversation logs and runs a Refresh whenever they change, so open
pages follow Conversations as they happen. Switching it on first starts
watching, then runs a catch-up Refresh, so nothing written in between is
missed.

A Conversation is **active now** while Live is on and its newest source change
— its log or any of its sub-agent transcripts — is under 2 minutes old. It is a
Live-only notion: with Live off the stored data is only as fresh as the last
Refresh, so no Conversation is active now.

### API request

One request Claude Code sent to the Anthropic API for an Agent's Turn, as the
conversation logs record it since Claude Code 2.1.300: the system prompt, the
tool definitions, every message exactly as sent, and the request parameters
(model, effort, thinking, maximum output, cache breakpoints). An API request is
either a Turn's request, which the Turn came from, or a Failed attempt of one.
Conversations logged by earlier versions have none. Its system prompt, its tool
set and each message it sent are **interned**: stored once under the sha256 of
their canonical JSON, and shared by every API request that names them.
_Avoid_: exchange, call (clashes with Tool call); piece, part, blob for what is
interned.

### What was sent

What a Turn's API request gave the model, shown on that Turn in the order the
model read it: the request parameters and when it was sent; the system prompt
and the tool definitions, each with how it changed since the previous API
request of the same Agent; how many earlier messages it repeated from that
request; and the messages new for this Turn, each **part** labelled by what it
is (a Prompt, a tool result, a piece of Injected context by its kind, …): a
content block, or one piece of Injected context from a block that fuses
several. It also gives the API request
**raw**: its body as rebuilt from the logs, as JSON. A system-prompt change is
**volatile** when only lines that move on their own changed — the date, the
git status, the working directory — and **real** otherwise. A message the logs
cannot rebuild is shown missing, at its place, and counted.

### Injected context

Text Claude Code adds to an API request on its own, neither typed by the user
nor returned by a tool: the CLAUDE.md and AGENTS.md files, the skill and agent
lists, MCP server instructions, the date, the environment, reminders. It comes
in **pieces**, each with a **kind** naming what it is (the CLAUDE.md and
AGENTS.md files by name, Skill list, Date, …); one content block can hold
several. Some of it also appears in the Transcript as Meta Messages; most of it
appears only in What was sent.
_Avoid_: system reminder (the wrapper it is sent in, not what it is), attachment.

### Failed attempt

An API request the API refused or dropped and that Claude Code then retried:
the same request of the same Agent, sent again. It belongs to the Turn whose
API request was the retry that succeeded, which shows how many failed attempts
preceded it and the time they lost, up to the retry. The logs record neither
its status nor its error message, and it never counts toward Cost.
_Avoid_: retry (that is the request after it), failed request.
