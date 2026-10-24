# The Agent's log file is the unit of re-parse

## Status

accepted. Amends ADR-0005's "each Conversation is still deleted and rewritten
in the same transaction" paragraph: a changed Conversation is now rewritten in
place, one Agent's file at a time, still in one transaction. Amended by
ADR-0011: the Agent's file stays the unit of re-parse, and a Sub-agent's
lineage is resolved from stored facts, never from the files a run parsed.

## Context

Live runs a Refresh at most every 2 s (`debounceMs`, `src/core/live.ts`). A
Live update that re-parses an active Conversation has to finish well inside
that window, or Live falls behind on exactly the sessions it is most useful for.
The bar is a Refresh under 1 s whose only changed Conversation is the largest
one on this machine.

The largest Conversation (a 19 MiB Main thread plus 18 Sub-agent files, 283 MiB
in all), measured in-process on a scratch root holding only that session:

| Run               | total   | discovery | parse | write |
| ----------------- | ------- | --------- | ----- | ----- |
| cold              | 4331 ms | 53        | 3348  | 887   |
| Main file touched | 3485 ms | 4         | 3033  | 420   |
| Main file touched | 3859 ms | 4         | 3294  | 533   |

Parsed one file at a time, the Main thread takes 304 ms and the 18 Sub-agent
files 2654 ms. The parse dominates, and about 90 % of it goes to Sub-agent
files that did not change. The composite change key (ADR-0005, `refresh.ts`)
re-parsed and rewrote the whole Conversation whenever any of its files moved.

## Decision

**The Conversation's composite key stays the first-level skip.** A
Conversation whose files did not move is not read at all.

**Behind it, each Agent's log file is the unit of re-parse and rewrite.** Each
`agent` row keeps its own file's change key (`source_mtime`, `source_size`;
NULL means none was recorded). In a changed Conversation:

- The Main thread is always parsed. It holds the Conversation's own columns,
  its Project, and the spawn ledger of the Sub-agents it started.
- A Sub-agent file is parsed when it is new or its key differs. No other file
  is: a Sub-agent's lineage is resolved from stored rows (ADR-0011).
- An Agent is rewritten only when its file changed: its row is deleted
  (cascading to its Messages, Tool calls and API requests) and written again. A
  Sub-agent whose file is gone is deleted. The Main thread's `pr_link` and
  `turn_duration` rows are replaced with it.
- The Conversation row is updated in place, so its id never changes, and the
  Conversations continuing from it need no re-pointing.
- Rows written by another parser version, by an interrupted run, or from another
  file (a duplicate that took over the session id) have every Agent rewritten.

**Cross-file links are resolved from stored rows.** A Sub-agent's lineage —
`parentAgentId`, `spawnedByMessageId`, `agentType`, `resolvedModel` — is
resolved for every Sub-agent of a written Conversation from its stored meta
facts and the Conversation's stored `Agent` calls and ledgers, fresh or kept
(ADR-0011, log-format §4). So a Sub-agent first stored before its parent
logged the spawn joins its parent on the Refresh after the parent's file
grows, and a kept child of a rewritten or removed parent is resolved again
without its file being read. A Turn whose API request was in a rewritten file
is linked again by the existing database-wide pass.

Everything for one Conversation still happens in one transaction, and a new
Conversation is still written in the cold path's order, so a fresh database gets
the same row ids. `agent-file-change.test.ts` checks that after each kind of
change (Main thread grown; Sub-agent grown, new, shortened or removed under a
kept child; a parent grown over a kept child; a spawn logged after the child
finished), the database holds, table for table with row ids replaced by natural
keys, what a cold Refresh of the same files holds.

The same session afterwards (`pnpm bench:refresh --live-update-of-largest-main-thread`):
the Live update takes 346 ms, 243 ms of it the Main thread's parse.

## Alternatives considered

- **Parsing only the bytes appended to the Main thread.** It would save the
  Main thread's 0.3 s out of 3.5, at the price of persisting the parser's state
  (five ledgers) across runs. At this machine's log sizes it is not worth it.
- **Parsing every Sub-agent whose lineage might change.** That would make every
  ledger exact, but it is the full parse this decision removes, on every Live
  update while a Sub-agent runs.

## Consequences

- A Live update costs what its changed files cost: the Main thread's parse and
  write, plus whichever Sub-agent files moved.
- `RefreshSummary.logFilesParsed` counts the log files a Refresh read.
- A Turn already linked to an API request in another file keeps that link when
  a rewritten file of its Conversation now holds a better-ranked copy of the
  request, as it already did across Conversations.
