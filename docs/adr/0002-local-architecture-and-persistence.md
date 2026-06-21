# Local architecture and persistence

## Status

accepted

## Context

The app is a single-user, fully local tool. Two constraints shaped the
architecture: the "find conversations + parse + store" logic must be **isolated
from the UI** so it can be reused, and viewing must not re-parse the logs every
time (an explicit goal). The user also asked for **Prisma**.

## Decision

**Isolated core.** All log discovery, parsing, and database access live in an
in-app module at `src/core/` with a strict no-`next`/no-`react` import rule. The
core owns **all** SQL/DB access behind typed functions (`refresh()`,
`listConversations()`, `getConversation()`, …); the Next app imports those and
never writes queries itself. A separate workspace package was considered and
rejected for now as heavier than needed — the boundary is convention-enforced,
and `src/core/` can be promoted to a package later without changing callers.

**Persistence.** SQLite via **Prisma 7** — the `prisma-client` generator plus
the `@prisma/adapter-better-sqlite3` driver adapter (synchronous, ideal for a
local tool). `schema.prisma` and the generated client live under `src/core/`.
Schema changes use **versioned `prisma migrate`** (the schema will grow as the
deferred doors open). The database file is **`./data/analyzer.db`**, gitignored.
A `globalThis` singleton prevents duplicate clients under dev hot-reload.

**Refresh.** User-triggered via a Next **server action** (synchronous, with a
spinner) that calls `core.refresh()` and returns a summary. Refresh is
**incremental**: each `conversation` row stores its source file's `mtime`+`size`;
on refresh the core re-parses only new/changed conversation files (replacing
their rows in a per-conversation transaction), skips unchanged ones, and drops
rows for deleted files. The first (cold) refresh parses everything
(~seconds–tens of seconds); subsequent refreshes are near-instant.

**Cost** is computed in application code from a hardcoded, versioned price list
(see ADR-0001), never stored.

## Consequences

- The core/UI boundary is discipline, not a build barrier — easy to start, easy
  to erode; promote to a package if that becomes a problem.
- Prisma + better-sqlite3 is a native module: it must be in Next's
  `serverExternalPackages`, and the core may only run server-side (server
  actions / server components), never in the client bundle.
- Incremental change-detection keys on the **session file's** mtime+size. A
  sub-agent file changing without the parent session file changing would be
  missed; in practice the parent file is appended (the `Agent` tool result) when
  a sub-agent runs, so this is safe, and a full rebuild is always available as a
  fallback.
- Streamed refresh progress (SSE) was deferred; the sync action is the v1.
