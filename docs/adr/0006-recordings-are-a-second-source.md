# Recordings are a second source, kept outside the database

## Status

superseded by ADR-0007 (the conversation logs are the source of What was sent,
and the Recorder is retired). Narrowed ADR-0001's "transcript files are the
single source of truth" to Turns.

## Context

The conversation logs never show what Claude Code actually sent the API: the
system prompt, the tool definitions, injected system-reminders, timings, and the
Side requests Claude Code makes on its own (session naming, quota probes, the
safety monitor, suggestions), whose tokens are therefore missing from every
Cost. Only a proxy between Claude Code and the API sees them. Two facts shape
how it fits in:

1. **A Claude Code session pointed at a proxy that is down cannot reach the
   API**; there is no fallback. The proxy's lifetime must not depend on the app,
   which restarts on every `pnpm dev`.
2. **What the proxy sees cannot be rebuilt from anything else**, whereas the
   database is a cache that can always be rebuilt from the logs (ADR-0002).
   Every API request also repeats the whole history before it, so storing each
   one in full grows with the square of the Conversation (about 150 MB for a
   500-Turn Conversation near a full context).

## Decision

- **The Recorder is its own process**, started from the repo with tsx (from the
  CLI, or detached from the app so it outlives it). It listens on 127.0.0.1 at a
  fixed port (4242 by default), forwards every request unchanged, and exposes a
  health endpoint the app polls. It never opens the database.
- **Recordings are files**, under `~/.claude-convo-analyzer/recordings` by
  default, outside the repo's `data/`: append-only and compressed, one set per
  session. Each distinct piece — a system block, a tool definition, a message —
  is stored once under its hash, and an API request is its parameters, headers,
  timings and reassembled response plus the hashes of what it sent. The raw
  event stream is not kept. Auth and cookie headers and the `metadata.user_id`
  fingerprint are never written.
- **Refresh ingests Recordings like the logs**, into the same rebuildable
  database. The format's reader and writer are one framework-free module in
  `src/core`, shared by the Recorder and ingestion.
- **Precedence**: the transcript stays the source of truth for a Turn's usage;
  the matching API request (joined by `requestId`, then `message.id`) only adds
  what the logs lack. Side requests are counted in Cost from the Recording
  alone. Recording only ever adds to a Conversation; an unrecorded one is shown
  exactly as before.

## Considered options

- **The proxy as a route of the Next app**: one process, but restarting the app
  cuts every Claude Code session routed through it.
- **The proxy writing straight into the database**: it would compete with
  Refresh's per-Conversation delete-and-rewrite, and a database reset would lose
  data nothing can rebuild.
- **Each API request stored in full**:
  simplest, but quadratic in size.
- **Plain `node` with type stripping instead of tsx**: needs Node 22.18+, above
  the 20.9 that Next accepts; tsx is installed with the repo anyway.
