# Claude Conversation Analyzer

A local-only web app that reads the Claude Code conversation logs stored on your
machine, parses them deterministically into a SQLite database, and shows you
per-conversation token usage and cost — broken down by project, model, skill,
and sub-agent.

**Everything stays on your machine.** The app only reads `~/.claude/projects`
(and, if you use the optional [Recorder](#recording-what-claude-code-sent),
its Recordings) and writes a local SQLite file (`./data/analyzer.db`); every
path is configurable. Nothing is ever sent anywhere.

> **About the cost figure:** the cost shown is always _"what these tokens would
> cost through the public API"_. If you're on a Pro or Max subscription you
> don't actually pay per token — so treat the number as the equivalent API
> value of your usage, not a bill.

## Screenshots

The conversation list — total cost, tokens, and a per-folder breakdown across
every project, sortable by any column. The folder tree in the sidebar scopes
every page to one folder and everything under it, so a repo and its git
worktrees read as one:

![Conversation list](docs/images/main-view.png)

Expand any row for the per-model, per-skill, and per-sub-agent cost breakdown:

![Conversation detail](docs/images/conversation-detail.png)

Work rarely fits in one sitting. When you resume a session (or fork it), Claude
Code starts a new conversation linked to the previous one — so the app groups
them into a **continuation family**: rows that belong to one show a badge with
the family size, and the expanded panel draws the whole family as a tree,
chronological and indented by fork, with each sitting's date and cost, the one
you are looking at highlighted, sittings resumed from another project labelled,
and the cumulative total of the entire piece of work at the bottom. Click any
member to jump to it. The Transcript view of a family member carries the same
lineage as a one-line banner — what it continued from, and what continues it:

![Continuation family](docs/images/continuation-family.png)

When the API itself fails a turn — overloaded, rate-limited, timed out — you
usually only find out by opening the conversation. The list surfaces it instead:
any conversation with failed turns carries a badge with the count (sub-agent
failures included, since they are the conversation's failures too), and the
expanded panel lists each one — when it happened, which agent it happened in,
and what the API said — with a link straight to that turn in the Transcript. The
**Only with errors** toggle narrows the whole list to the conversations that hit
them, composing with the folder scope and the sort:

![API errors](docs/images/api-errors.png)

Open any conversation for the Transcript view — an IDE-like two-pane view with
the agent tree (main plus every sub-agent, each with its own cost) on the left
and one agent's turn-by-turn transcript on the right. Click a row's title to
land on the main agent, or a sub-agent in the cost breakdown to jump straight
into its transcript. Open a tool call for its full input and result; an Agent
call shows the Task prompt it gave its sub-agent and what that sub-agent handed
back, rendered as Markdown:

![Transcript view](docs/images/transcript-view.png)

The Trends page charts daily spend, stacked by model, over the last 7, 30 or 90
days or all time, for the selected folder.

The Tools page answers a different question: which tools you actually use, which
ones fail, and which ones flood your context. One row per tool — calls, error
count and rate, mean/median/p95 result size, the largest single result, and the
total volume of characters it returned — for the selected project and date
range, sub-agent calls included. Expand a row for its most recent errors and
biggest results, each linking straight to that call in the Transcript:

![Tools page](docs/images/tools-view.png)

Search answers the "where did we discuss X?" question. The search box in the
header is on every page; it searches what was _said_ — your prompts, Claude's
replies, and conversation titles — across every project, never tool output or
machine-injected noise. Results are grouped into one card per conversation, most
recently matching first, with up to three highlighted extracts; clicking an
extract opens that conversation's transcript at the exact message, in the right
agent. Quoted phrases work too:

![Search results](docs/images/search-view.png)

## Requirements

- [Node.js](https://nodejs.org) 20.9 or newer
- [pnpm](https://pnpm.io)
- Some existing Claude Code usage — the app analyzes the logs Claude Code writes
  to `~/.claude/projects`.

> **Platform support:** Tested on macOS and WSL. It has **not** been tested on
> native Windows and may not work there.

## Getting started

```bash
git clone https://github.com/flolefebvre/claude-convo-analyzer.git
cd claude-convo-analyzer
pnpm install      # also generates the Prisma client (postinstall)
pnpm build
pnpm start
```

Then open [http://localhost:3000](http://localhost:3000).

On first launch the SQLite database is created and migrated automatically — no
manual database setup. Click **Refresh** in the UI to ingest your conversation
logs; the parse is incremental, so subsequent refreshes only read what changed.
A Refresh runs in the background and every open page shows its progress, so you
can keep browsing while it runs. When an update changes how logs are parsed,
the app says so and asks for a Refresh.

For live development instead of a production build:

```bash
pnpm dev
```

Three environment variables move what the app reads and writes; a relative
value resolves against the process working directory (the repo root under
`pnpm`):

- `CCA_DB_PATH` — the SQLite file (default `./data/analyzer.db`), created and
  migrated on first use.
- `CCA_LOGS_ROOT` — the logs root that **Refresh** scans (default
  `~/.claude/projects`).
- `CCA_RECORDINGS_ROOT` — the Recordings that **Refresh** also reads and the
  Recorder writes (default `~/.claude-convo-analyzer/recordings`).

```bash
CCA_DB_PATH=data/demo.db CCA_LOGS_ROOT=/tmp/demo-logs pnpm dev
```

## Recording what Claude Code sent

The logs show the conversation, but not what Claude Code actually sent the API:
the system prompt, the tool definitions, the system-reminders it injects, the
requests it retried, and its own background requests (naming the session,
probing your quota, the safety monitor, suggestions), whose tokens are missing
from every cost the logs alone give. The **Recorder** fills that gap: an
optional local proxy that forwards every request to the Anthropic API unchanged
and keeps a copy on disk.

Start it in its own terminal and leave it running:

```bash
pnpm recorder
```

It prints the `ANTHROPIC_BASE_URL` line to use; start Claude Code with it:

```bash
ANTHROPIC_BASE_URL=http://127.0.0.1:4242 claude
```

Only sessions started that way are recorded. Click **Refresh** in the app and a
recorded conversation gains:

- **What was sent** on each turn: the messages new since the previous request
  (injected context included), how the system prompt and tools changed, the
  request parameters and timings.
- **Failed attempts**: the overloaded, rate-limited or dropped requests Claude
  Code retried before the turn succeeded, and the time each one lost.
- **Side requests**: Claude Code's background requests, in the Transcript and
  in the conversation's cost.

Stop the Recorder with Ctrl-C; it lets requests in flight finish first (press
twice to quit at once). Don't stop it while a session started through it is
still running: that session can't reach the API without it. `CCA_RECORDER_PORT`
(default 4242) and `CCA_RECORDER_UPSTREAM` (default `https://api.anthropic.com`)
change where it listens and where it forwards; `pnpm recorder --help` lists
them.

Recordings are compressed and append-only, one file per session, and never
store auth headers. Unlike the database they can't be rebuilt from anything
else, so they live outside the repo. Their format is documented in
[`docs/recording-format.md`](docs/recording-format.md).

## How it works

The app discovers each **project** (a directory where you ran Claude Code) under
`~/.claude/projects`, parses every session's `.jsonl` transcript, and stores a
deterministic, deduplicated token ledger. Recordings, when present, only add to
it: a turn's usage always comes from the logs. Cost is computed in application code
from a per-model, per-token-type price list — it's a hypothetical "what these
tokens would list for on the public API today" figure, not your actual billing.

The domain model and the reasoning behind it are documented in
[`GLOSSARY.md`](GLOSSARY.md) and the ADRs under [`docs/adr/`](docs/adr).

## Roadmap

Today the app answers _"where did the tokens and cost go?"_. The next steps push
it toward _"what actually happened in these conversations, and how do I make them
better?"_

- **Usage stats by skill and sub-agent.** The Tools page already covers tool
  usage (calls, errors, result sizes). The same behavioural lens still has to
  reach skills and sub-agents — how often each skill fires, how sub-agents are
  distributed across a run — so you see your real usage patterns, not just the
  bill.

- **Deeper conversation analysis — surfacing friction.** When running fully
  autonomous, different sub-agents often grind on the _same_ underlying problem —
  e.g. a missing piece of context like how to invoke a command. The goal is to
  detect these recurring friction points automatically and make them visible, so
  a single fix (a note in `CLAUDE.md`, a better tool description) can unblock
  every future run instead of each agent rediscovering the wall.

Have an idea or a friction pattern you'd like surfaced? Open an issue.

## Development

The validation gate — format check, lint, duplication and typecheck in
parallel, then test and build in parallel, then the Playwright end-to-end specs;
it passed only if the output ends with `--gate OK--`. `pnpm check` is the faster
inner loop: the same static checks, then only the tests affected since
`origin/main` (`--check OK--`):

```bash
pnpm check
pnpm gate
```

The end-to-end specs need Chromium, installed once with
`pnpm exec playwright install chromium`.

See [`docs/codebase/testing.md`](docs/codebase/testing.md) for the testing
approach and fixtures.

For demo data, `pnpm seed` builds a self-contained seed environment in
`data/seed/`: invented logs in `data/seed/projects/`, ingested into
`data/seed/seed.db`, and invented Recordings of some of them in
`data/seed/recordings/`. Each run wipes and rebuilds that directory; your real
database, logs and Recordings are never read or written. To seed and serve the
app on it in one step:

```bash
pnpm dev:seed
```

It prints `Seeded app: http://localhost:<port>` — the first free port from
3001, or `PORT` when set — so several checkouts can each run their own. Refresh
in that app re-reads only the seeded logs, and `CCA_RECORDINGS_ROOT` points at
the seeded Recordings.

The seeded activity ends now. `pnpm seed` also takes `--now=<ISO>`, and the same
`--now` always yields the same data, which is what screenshots want; point the
app at that seed with the two variables above, and `CCA_RECORDINGS_ROOT` at its
Recordings:

```bash
pnpm seed --now=2026-06-22T17:00:00Z
CCA_DB_PATH=data/seed/seed.db CCA_LOGS_ROOT=data/seed/projects CCA_RECORDINGS_ROOT=data/seed/recordings pnpm dev
```

## Was this made with AI?

Yes.

## How to contribute

Found a bug or have an idea? Open an issue.

## License

[MIT](LICENSE)
