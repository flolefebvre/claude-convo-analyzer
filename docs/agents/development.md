# Development workflow

How features get built and validated in this repo. The short version lives in
`CLAUDE.md`; this is the detail.

## Test-driven development

Use the `tdd` skill. The rules that matter here:

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
- Match test names and interface vocabulary to `CONTEXT.md`; respect the ADRs
  in the area you touch (`docs/adr/`).

## Fixtures

The parser is pure-ish over JSONL, so tests run against small, sanitized
fixture files that encode the tricky cases documented in
`docs/conversation-log-format.md`. Maintain at least one fixture per gotcha:

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

## The validation gate (definition of done)

A feature is complete only when all four commands pass and print their sentinel.
The sentinel exists so a run is verifiable — a command that exits 0 but does not
print its `OK` line is treated as a failure.

| Command | Sentinel | Checks |
|---|---|---|
| `pnpm test` | `TEST OK` | vitest — behavior |
| `pnpm lint` | `LINT OK` | eslint — style/correctness |
| `pnpm fallow` | `FALLOW OK` | dead code, circular deps, duplication, complexity, **architecture boundaries** |
| `pnpm build` | `BUILD OK` | `next build` — it compiles |

Run them yourself; don't claim done on assumption. This is a documented
discipline, not a git hook — there is intentionally no commit-time enforcement,
so rapid red-green cycles stay fast.

### fallow and the core boundary

`pnpm fallow` is also how the `src/core` isolation from ADR-0002 stays real:
configure its architecture/boundary rules so a `next` or `react` import inside
`src/core` is a violation. The boundary is then enforced by a tool, not just by
convention.
