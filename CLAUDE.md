@AGENTS.md

## Development workflow

**TDD.** Build features test-first via the `tdd` skill (red → green → refactor,
one vertical slice at a time — never all tests then all code). Tests exercise
**public interfaces**, not internals: the `src/core` functions (`refresh()`,
`listConversations()`, `computeCost()`, …) against small sanitized JSONL
fixtures. Strict TDD on `src/core` and cost logic (deterministic, the critical
path); pragmatic, lighter testing on the Next UI. Match test names and
vocabulary to `CONTEXT.md` and respect the ADRs.

**Definition of done — the validation gate.** A feature is not done until **all
four** pass, each printing its `OK` sentinel:

```
pnpm test    # → TEST OK    vitest
pnpm lint    # → LINT OK    eslint
pnpm fallow  # → FALLOW OK  dead code, cycles, duplication, complexity, core boundary
pnpm build   # → BUILD OK   next build
```

Run them yourself and confirm each sentinel before calling work complete. Treat
a missing sentinel as a failure. `pnpm fallow` also guards the `src/core`
isolation boundary (no `next`/`react` imports — ADR-0002). See
`docs/agents/development.md` for fixtures, what to test, and details.

## Agent skills

### Issue tracker

Issues are tracked in this repo's GitHub Issues via the `gh` CLI; external PRs are not a triage surface. See `docs/agents/issue-tracker.md`.

### Triage labels

Default canonical labels — `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: one `CONTEXT.md` + `docs/adr/` at the repo root. See `docs/agents/domain.md`.
