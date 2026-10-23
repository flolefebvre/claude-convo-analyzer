# The Refresh writes through bare better-sqlite3

## Status

accepted. Amends ADR-0002's Persistence paragraph: Prisma owns the schema,
the migrations and every read, but not the Refresh write path. ADR-0010
amends the Decision's "each Conversation is still deleted and rewritten"
paragraph: a changed Conversation is rewritten in place, one Agent's file at a time.

## Context

A cold Refresh over a real `~/.claude/projects` (5.9 GB, about 2,450
Conversations) took 268 s, and a run right after a parser bump cost the same.
A controlled A/B test wrote one frozen corpus of 2,452 Conversations (388k
Messages, 191k Tool calls) into fresh WAL databases with the search triggers on.
Every variant stored identical row counts and content checksums in all seven
tables:

| Write path                                                                                   | Write-pass time | Time inside SQLite |
| -------------------------------------------------------------------------------------------- | --------------- | ------------------ |
| Prisma 7.8.0, `createMany` per table per Agent, one interactive transaction per Conversation | 185 s           | ~41 s              |
| Same code on Prisma 7.10.1                                                                   | 187 s           | ~40 s              |
| Prisma with multi-row raw `INSERT`s                                                          | 60–62 s         | ~38 s              |
| Bare better-sqlite3, prepared statements reused, one native transaction per Conversation     | 41–49 s         | ~40–48 s           |

SQLite does the same work in every variant: the ~140 s difference is Prisma's
own overhead. A CPU profile of the write pass alone puts it at 64% of the time:
68 s in the WASM query compiler, 13 s in its glue code, 36 s in
`@prisma/client`. `createMany` is left out of the query-plan cache (still in
7.10.1), and even with the cache its key changes with the batch's row count. No
setting helps: `queryPlanCacheMaxSize` acts after that exclusion,
`compilerBuild` is already `"fast"`, and neither smaller chunks nor a higher
`maxBindValues` moved the result by more than about 2%.

## Decision

**`refresh()` runs on one bare better-sqlite3 connection**, opened by
`openRefreshConnection` in `src/core/db.ts`: the skip decision, the deletes of
vanished Conversations, the Conversation writes, and the continued-from and
stamp passes. The connection applies the migrations first, as every Prisma
client does, and sets `foreign_keys = ON`: the cascades of a deleted
Conversation remove its child rows and fire the search index's delete triggers.

**Every statement lives in `src/core/prisma/refresh-statements.ts`**, beside
the schema, prepared once per run and reused for every Conversation. Ids come
from each insert's `lastInsertRowid`, never from a read-back. Rows go in the
order the Prisma path used, so a fresh database gets the same row ids.

**Commits are batched.** One transaction holds Conversations until it holds 50
of them or 1 s has passed since it opened. Each Conversation is still
deleted and rewritten in the same transaction, so a reader on another connection
sees the old version or the new one, never neither. Progress goes out once per
commit, with `done` the number of Conversations committed so far. The
continued-from pass and the stamp pass share one final transaction, and the
parser-version stamp stays the commit mark: an interrupted run leaves its
committed Conversations unstamped, and the next run completes them.

Measured with `pnpm bench:refresh` on a frozen copy of the same logs (2,462
Conversations): 239 s before, 85 s with one transaction per Conversation, 71 s
with batches of 50. Batches of 10 took 75 s, and batches of 200 took 70 s, within noise of 50.

## Alternatives considered

- **Prisma with multi-row raw `INSERT`s.** Brings the write pass to about 60 s.
  It is hand-written SQL all the same, still pays Prisma's per-query overhead,
  and gives back no ids, so the message-to-tool-call linkage needs a read-back.
- **A newer Prisma, or tuning it.** 7.10.1 changes nothing, and no setting moves
  the result by more than about 2%.

## Consequences

- The writer mirrors `schema.prisma` by hand, in one module. A comment at the
  top of the schema points at it, and `stored-data-equivalence.test.ts` pins
  each table's row count and checksum for the fixture logs, so a column the
  writer does not follow fails the suite.
- Prisma remains the owner of the schema, the migrations, and every read
  (`read.ts`, `search.ts`, `tool-stats.ts`, the app).
- The search triggers keep working unchanged: they fire on plain inserts and on
  cascade deletes.
- Progress moves in steps of up to 50 Conversations rather than one at a time.
- Parsing (about 43 s of the 71 s) is now the larger cost; parallel parsing
  across workers is the next lever, if ever needed.
