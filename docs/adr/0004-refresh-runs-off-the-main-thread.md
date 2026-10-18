# Refresh runs off the main thread

## Status

accepted. Supersedes ADR-0002's Refresh paragraph and its "SSE deferred"
consequence. Live amends the start rules below.

## Context

A Refresh used to run inside the server action that started it, on the Node
main thread, and it froze the whole process for its entire duration. Every
page and navigation hung, not just the button. A cold run over the real logs
took 268 s, and a 10 ms timer probe never fired during it. Even a warm run with
nothing to re-parse (about 0.4 s) blocked for all of its duration.

The cause is structural. better-sqlite3 is synchronous, and the Prisma driver
adapter resolves every query as a microtask, so an awaited Prisma call never
hands the event loop a turn: the whole run is one long task. The Refresh also
has to be shared: the glossary's Refresh is one run per server process, which a
click starts or joins, and which outlives the page that started it.

## Decision

**A worker thread runs each Refresh.** `src/core/refresh.worker.ts` calls
`refresh()` and relays its progress and summary as messages. The server spawns
it with `new Worker(new URL("./refresh.worker.ts", import.meta.url))`, a pattern
Turbopack bundles as its own entry under both `next dev` and `next build` +
`next start`. The TypeScript path aliases, better-sqlite3 and the Prisma client
all load inside it. The worker has its own `globalThis`, so it opens its own
database connection; it gets a copy of `process.env`, so `CCA_DB_PATH` and
`CCA_LOGS_ROOT` still apply. Readers on the main thread run beside it under WAL
(ADR-0002) and see each Conversation as soon as its transaction commits.

**A refresh runner on the main thread owns the run**
(`src/core/refresh-runner.ts`). It holds the one Refresh the process runs at a
time: a start while one runs joins it, a start after it settled begins a new
one, and a failure rejects every waiter and leaves the next start to run
fresh. A throw in the worker, or an exit before the summary (where an
out-of-memory crash lands), is such a failure. There is no cancel and no start
at boot, except when Live was left on: it then starts watching and runs a
catch-up Refresh. A change Live sees while a Refresh runs does not join it, since
that run may already have read the file; it queues exactly one more Refresh
after it. The runner keeps the current
state: idle, running with the latest `{ done, total }`, or the last summary or
error. It takes the job as a dependency, so its logic is tested in-process. The
process-wide instance lives in a `globalThis[Symbol.for(…)]` slot, created on
first use, so a dev re-evaluation joins the running Refresh instead of starting
a second one.

The Refresh server action awaits the shared run and returns its summary.

**Progress will stream** to every open page over next-sse's in-memory transport,
fed from the runner's state (#112). One server process serves this local app, so
an in-memory transport is enough.

## Alternatives considered

- **Chunked yielding on the main thread**: parse and write in slices, with a
  `setImmediate` between them. It only slices the freeze. Awaiting Prisma
  calls is no yield at all: across the 268 s cold run, a 10 ms timer probe
  never fired, because each Prisma call resolves as a microtask over
  synchronous SQLite. So yielding needs explicit macrotask breaks everywhere,
  and every slice still blocks every request for its whole length. The parse
  of one large Conversation is itself a long synchronous task.
- **A forked child process running the Refresh through tsx.** Real isolation,
  but it ships a dev dependency (tsx) as a runtime requirement, needs its own
  entry outside the Next bundle with its own alias resolution, and talks over
  process IPC. A worker thread gets the same off-main-thread execution from
  the existing bundle.

## Consequences

- A Refresh no longer blocks rendering: pages read and navigate during a run and
  show whatever is already committed.
- The run outlives its request, so the action may return to one caller while
  others still wait on the same promise; their summaries are identical.
- An out-of-memory Refresh kills only its worker. The waiting callers get the
  error, and the server stays up.
- The worker's `.ts` graph only loads through a bundler or a TypeScript loader.
  Tests spawn it with `--import tsx`.
