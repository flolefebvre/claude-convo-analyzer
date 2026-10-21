# The conversation logs are the source of What was sent, and the Recorder is retired

## Status

accepted. Supersedes ADR-0006, and restores ADR-0001's "transcript files are
the single source of truth", which ADR-0006 had narrowed to Turns.

## Context

ADR-0006 added the Recorder because the conversation logs never showed what
Claude Code sent the API. Since Claude Code 2.1.300 they do: every log file,
main thread and Sub-agent alike, records each API request exactly — system
prompt, tools, messages and parameters — as `api-request` records whose
pieces are stored once under their hash (`docs/conversation-log-format.md`,
§9). Three facts shape what follows:

1. **The logs can rebuild the database; Recordings cannot.** A Recording
   holds what nothing else does, so it had to live outside the database
   (ADR-0006). Request records are part of the logs, which the database
   already caches (ADR-0002).
2. **The logs leave out little of the request**: the billing-header system
   block, `metadata`, `stream`, and from 2.1.304 the safety classifier's
   `safeguards`, which the model never saw anyway.
3. **A Recorder that is down cuts Claude Code off from the API**, and it is
   the only thing that does: every other part of the app can stop without
   touching Claude Code.

## Decision

- **The logs are the only source of API requests**, from Claude Code 2.1.300
  on.
- **Refresh stores them in the database** like everything else parsed from the
  logs: each piece — system prompt, tool set, message — stored once under its
  hash, without `safeguards`. The database stays a cache that can be rebuilt
  from the logs.
- **The Recorder, Recordings, Side requests and Unlogged usage are removed.**
  Cost becomes the logged Turns only.
- **Turns before 2.1.300 have no What was sent.**

## Considered options

- **Read request bodies on demand from the log file** (ADR-0006's model):
  rejected. Unlike Recordings, the logs can rebuild the database, and nothing
  else in the app reads a log at view time.
- **Keep the Recorder as a side source**: rejected. Two sources of one thing
  would confuse; a Recorder that is down cuts Claude Code off from the API; and
  what only it gave — Side requests, timings, headers, the status of a Failed
  attempt — is not worth that.
- **Build a degraded What was sent from `prompt_snapshot` for 2.1.266–2.1.299**:
  rejected. Snapshots miss every tool loaded mid-session.
- **Unlogged usage from `cost-state`**: deferred to #223. The figure is per
  process and cannot be attributed to a Conversation.

## Consequences

- The database grows by the messages as sent: about 720 MB of distinct stored
  messages for 330 main Conversations on the author's machine, almost all of
  it full tool results. System prompts and tool sets add little — a few
  hundred distinct ones across over a thousand snapshots.
- Lost with the Recorder: Side requests, Unlogged usage, time to first byte,
  rate-limit headers, and the status and error of a Failed attempt, which the
  logs record as a retry with neither.
