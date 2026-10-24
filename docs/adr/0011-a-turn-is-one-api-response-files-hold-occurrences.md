# A Turn is one API response: files hold occurrences, the Refresh's resolve decides who owns it

## Status

accepted. Amends ADR-0001: Cost and every total are sums over `turn`, not
`message`, and a Conversation's Cost is its own spend, never the history it
copied. Amends ADR-0010: the Agent's file stays the unit of re-parse, but a
parse no longer reads a Sub-agent's parent for its lineage, and the "known
limit" paragraph no longer applies.

## Context

ADR-0001 took a log file to hold one thing: a Conversation is one
`<sessionId>.jsonl`, an Agent is one transcript, and a Turn is counted once per
`message.id` _within a file_. Claude Code breaks that in six ways, measured on
this machine's logs (2.1.143–2.1.310, October 2026):

- a resumed session copies its parent's records into its own file;
- a forked session copies them the same way;
- a forked Sub-agent copies its spawner's records;
- both kinds of fork rewrite the spawning Turn under a new `uuid` with the
  same `message.id` and usage;
- a resumed session's `subagents/` holds symlinks to its parent's transcripts;
- a Turn's streamed records grow: `output_tokens` rises from the first record
  to the last, and a spawner's file can keep a partial count where its fork's
  copy holds the final one.

1,121 `message.id`s are held by more than one file; every one that is not a
mock API's (`msg_fake*`, `msg_extractor`, no `requestId`) is a copy. Between
issues #226 and #298, thirteen issues each added a rule for one shape — a
`uuid` prefix rule, a spawn-link rule, a `message.id` rule, a holder order for
`Agent` calls, another for ledger claims — and each fix found the next shape.
Half their acceptance criteria were about a cold and an incremental Refresh
agreeing, because Sub-agent lineage was decided during the write from the
ledgers in the files _that run_ happened to parse.

## Decision

**A Turn is one API response, identified by its `message.id` across all the
logs.** Each file that holds it holds an _occurrence_. A Turn without a
`requestId` (a mock API's, a synthetic record) is its own file's. Its usage is
the highest value of each bucket over all its records and occurrences. A user
Message is matched across files by its `uuid` the same way.

**One Agent owns each Turn and Message, by one rule.** Among the Agents
holding it, the ancestor owns it — the continued-from parent, the spawning
Agent, at any depth; with no lineage between the holders, the smallest log
path owns it; the only holder owns it, copy or not. The same rule picks the
holder of an `Agent` call, so a Sub-agent's spawner is the owner of the call
its meta file's `toolUseId` names. There is no separate holder order and no
ledger-claim order.

**The Refresh extracts, then resolves.** Parsing a file is a pure function of
that file: its Messages and Turn occurrences with the file's own usage, the
ledgers and `continued-in` records it holds, its meta file. Every cross-file
fact — Turn ownership, the `turn` row, Sub-agent lineage, `continued_from`,
request links — is computed in the links pass from stored facts alone, for
every Conversation a run touched and every Agent sharing a Turn or Message
with one. A cold and an incremental Refresh then agree by construction, and
the equivalence suite guards the resolve, not each rule.

**Storage.** `message` keeps one row per occurrence with the file's own usage.
A new `turn` table holds one row per Turn: its `message.id`, the owning Agent
and Conversation, its highest usage and its model; the resolve writes it. Cost,
totals and breakdowns sum `turn`. A Copied Message is an occurrence whose
Agent is not the owner.

**Explicit records first; content matching frozen.** Where Claude Code writes
the relation down — `continued-in`, `fork-context-ref`, the meta file's
`toolUseId` and `agentType` — it decides. The prefix-containment rule for
`continued_from` stays only for logs before 2.1.296 and gains no cases; the
ledger is read for a Sub-agent's spawner and type only when its meta file
states nothing. A new log shape is met by reading the record Claude Code
writes for it, not by a new matching rule.

## Considered options

- **Scope Turn identity to a Continuation family.** Misses the near-forks no
  record links (6 here) and makes Turn identity wait on family detection.
- **Patch the owner's `message` row with the highest usage and an owned flag.**
  Less work, but the resolve would then overwrite an extracted fact, and the
  first slice would already blur the line this decision draws.
- **Keep counting copied history and label it** (#285, option B). Leaves the
  overview over-counted by about 1.3 % and a family's cumulative total
  double-counted by construction.

## Consequences

- Headline numbers change twice: output tokens rise (the first-record usage
  undercounted them by about 36 % on this machine), and copied history stops
  counting (about 1.3 %). Both need a `PARSER_VERSION` bump.
- The parent-deleted case: a copier that is a Turn's only holder owns it, so
  its Cost includes the history — the spend was real and is recorded nowhere
  else.
- A symlinked transcript is ingested under both Conversations and owned by the
  parent's; the copier's tree shows it at no cost.
- A Conversation's time bounds are its owned Messages', read-side.
- The resolve's cost on a Live update is the open risk: the first slice that
  moves a cross-file fact into it carries ADR-0010's bar (a Live update of the
  largest Main thread under 1 s) and stops the sequence if it misses.
- API requests keep their own cross-file resolution (#226, #243); nothing
  there double-counts, so they are left as they are.
