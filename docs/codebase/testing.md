# Testing

This project uses TDD, via the `tdd` skill. The rules that matter here:

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
  named in the vocabulary of `CONTEXT.md`.

## Fixtures

The parser is pure-ish over JSONL, so tests run against small, sanitized
fixture files (`src/core/__tests__/fixtures/`) that encode the tricky cases
documented in `docs/conversation-log-format.md`. Maintain at least one fixture
per gotcha:

- a turn written as **multiple records with the same `message.id`** (dedup must
  count it once);
- a **sub-agent transcript** under `subagents/` plus the parent's `Agent`
  `toolUseResult` (must count once, from the transcript — never both);
- an assistant turn with **`attributionSkill`** (per-skill cost is exact);
- a **`<synthetic>`** / unknown model (priced $0 but flagged);
- a conversation whose **first message `parentUuid`** resolves into another
  session (`continued_from`);
- a `Bash` and a `Skill` **`tool_use`** (tool-call capture, CLI/skill
  detection).

Fixtures are committed, tiny, and contain no secrets. They double as executable
documentation of the log format.

## The validation gate

The gate itself — `pnpm gate` and its `--gate OK--` marker — lives in
`AGENTS.md`. Two details behind it: the marker exists so a run is verifiable
(a run that doesn't end with `--gate OK--` is a failure, whatever the rest of
the output says), and it is a documented discipline, not a git hook — there is
intentionally no commit-time enforcement, so rapid red-green cycles stay fast.
During those cycles, run the individual scripts (`pnpm test`,
`pnpm test:watch`, …); the gate is for the end.
