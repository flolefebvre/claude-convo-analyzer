# Testing

This project uses TDD. The rules that matter here:

- **Vertical slices, not horizontal.** One test → its implementation → repeat.
  Never write all tests then all code — that produces tests of imagined shape
  rather than real behavior.
- **Test public interfaces, not internals.** Exercise `src/core`'s exported
  functions and the cost calculators. Do not assert on private helpers, SQL, or
  table shapes — those are free to change. A test should read like a spec:
  "sums tokens once per message id", "does not double-count sub-agent usage",
  "flags a `<synthetic>` model as unpriced".
- **Where the rigor goes.** `src/core` (parsing + accounting) and the pricing
  functions are deterministic and are the critical path — strict TDD. The Next
  UI is tested pragmatically (a few behavior checks), not exhaustively.
- Tests live in `src/core/__tests__/`, one `.test.ts` file per behavior area,
  named in the vocabulary of `GLOSSARY.md`.
- Tests of `scripts/` live beside the script they test, as `*.test.ts`
  (e.g. `scripts/seed/seed.test.ts`), and so do the launcher's, beside its
  pure decisions in `src/launcher/`; its I/O edge is covered by `pnpm smoke`;
  and `src/lib`'s, beside the module (e.g. `src/lib/project-path.test.ts`).
- **One timeout for the whole suite.** `vitest.config.ts` sets `testTimeout`
  and `hookTimeout` to 30 s: a cold Refresh of a fixture root, in a test or in
  `seededTempDb`'s `beforeEach`, sits near Vitest's 5 s default on the Windows
  CI runner. A test does not set its own timeout.

## End-to-end

- Every route gets an `instant()` spec in `e2e/<route>.spec.ts` (Playwright, with
  `instant` from `@next/playwright`). It asserts what the route's static shell
  shows. A route ticket begins with that spec failing. A route with `instant = false` gets none — the
  catch-all and the export page.
- Inside the `instant()` scope, assert three things: the shell content is
  visible (the page header, the controls), the Suspense fallback is visible,
  and the streamed data has count 0. After the scope, assert that the data
  appears. `e2e/search.spec.ts` is the pattern to copy.
- Cover both entry points: an initial load (`page.goto` inside the scope,
  passing `{ baseURL }` to `instant()`), and a client navigation that clicks a
  real link, then `waitForURL` before any assertion.
- Prove the spec can fail once: move the asserted element inside the boundary,
  watch it fail on that element, then revert.
- Query the seeded data (`scripts/seed/fake-logs.ts`) with role and text
  locators. Don't add test ids.
- The exception to one spec per route: a spec with side effects on state
  every open page shares — `e2e/active-now.spec.ts`, which switches Live on.
  `playwright.config.ts` runs such specs as the `shared-state` project, after
  every other spec and one file at a time. A Live Refresh re-renders every open
  page, and that re-render lands inside other workers' `instant()` scopes and
  breaks them. The `shared-state` project holds no `instant()` check, and a
  failure elsewhere skips it.
- The other exception: `e2e/server-binding.spec.ts` is about the server, not a
  route. It checks that the e2e server binds loopback only: refused on this
  machine's network address, answering on `127.0.0.1`.
- A spec that acts on a client control right after a load waits for evidence
  that the control takes input: `gotoInteractive` (`e2e/interactive-page.ts`)
  in place of `page.goto`, as `e2e/active-now.spec.ts` and `e2e/search.spec.ts`
  do. Playwright's `load` does not wait for React to reveal the streamed
  boundaries, and a Suspense fallback that looks like its control is pressed
  instead of it: the event is lost.
- The specs run against a production build (`pnpm e2e:server`), because `next dev`
  doesn't prefetch. A dev `instant()` GREEN on a client navigation is not
  evidence that the prefetched shell commits.
- While you work on a route's loading states, use the dev overlay's
  blocking-route insight and the Navigation Inspector (Next.js DevTools, "Pause
  on navigations") as the inner loop. `pnpm e2e` is the check.
- `pnpm e2e` is the last stage of `pnpm gate` and its own CI job. `pnpm check`
  leaves it out to stay fast. Running it is covered in `docs/codebase/ui-checks.md`.

## Fixtures

The parser is pure-ish over JSONL, so tests run against small, sanitized
fixture files (`src/core/__tests__/fixtures/`) that encode the tricky cases
documented in `docs/conversation-log-format.md`. Maintain at least one fixture
per gotcha:

- a turn written as **multiple records with the same `message.id`** (dedup must
  count it once);
- a Sub-agent's turn written as three records whose **`output_tokens` grows**
  (its usage is the highest of each bucket), and a fork whose copy holds the
  final count of a Turn its spawner's file keeps partial (`growing-turn-usage-logs/`,
  log-format §3);
- a mock API's Turn, **no `requestId`**, under one message id in two unrelated
  files: two Turns (`requestless-turn-logs/`, log-format §3);
- a **sub-agent transcript** under `subagents/` plus the parent's `Agent`
  `toolUseResult` (must count once, from the transcript — never both);
- an assistant turn with **`attributionSkill`** (per-skill cost is exact);
- a **`<synthetic>`** / unknown model (priced $0 but flagged);
- resumed and forked Conversations that **copy their parent's records**, named
  by a `continued-in` record or, in an older log, by no record, a copy of a
  copy, a copied Sub-agent transcript, and a copy whose original is gone
  (`family-logs/`, log-format §10);
- a Sub-agent forked by another Sub-agent, and a fork of that fork, each
  transcript **copying its spawner's records** (`forked-agent-logs/`,
  log-format §10);
- Sub-agents with an **`agent-<id>.meta.json`** beside their transcript: a
  background launch whose ledger states no type, a ledger whose type differs
  from its meta file's, a malformed meta file, and Sub-agents no ledger names,
  one spawned by the Main thread, one by a Sub-agent whose fork copies the
  spawning call, and a fork whose own fork copies its spawning call. Also a
  nested Sub-agent named by its spawner's ledger
  (`agent-meta-logs/`, log-format §4);
- a `Bash` and a `Skill` **`tool_use`** (tool-call capture, CLI/skill
  detection);
- every **`origin` shape and `queued_command` attachment** of log-format §8,
  duplicate delivery included (`agent-message-logs/`, records addressed by
  `uuid` through `__tests__/helpers/agent-messages.ts`);
- a resumed Conversation whose copied Turns name an **API request in another
  session's file**, one held by two files, and one held by none
  (`resumed-request-logs/`).

Fixtures are committed, tiny, and contain no secrets. They double as executable
documentation of the log format.

## The validation gate

The gate itself — `pnpm check`, `pnpm gate` and their `--check OK--` /
`--gate OK--` markers — lives in the Verification section of `AGENTS.md`. Two
details behind it: the marker exists so a run is verifiable (a run that doesn't
end with it is a failure, whatever the rest of the output says), and it is a
documented discipline, not a git hook — there is intentionally no commit-time
enforcement, so rapid red-green cycles stay fast. During those cycles, run the
individual scripts (`pnpm test`, `pnpm test:watch`, …) or `pnpm check`; the
gate is for the end.

`pnpm check` runs only the tests whose module graph reaches a file changed since
`$CHECK_BASE`. A fixture is read from disk, not imported, so the graph can't see
it: the fixtures directory, the Prisma schema and migrations, and the configs are
`forceRerunTriggers` in `vitest.config.ts`, rerunning the whole suite. Add a path
there when tests depend on a file they don't import.
