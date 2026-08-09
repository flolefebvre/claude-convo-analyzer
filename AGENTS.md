## Context

`claude-convo-analyzer` is a local-only web app that reads the Claude Code conversation logs on this machine (`~/.claude/projects/`), parses them deterministically into a SQLite database, and presents analysis — per-conversation token usage and cost first. Everything runs locally; there is no server, auth, or telemetry.

## Stack

- Next.js 16.3 (App Router, Cache Components), React 19.2 with the React Compiler
- TypeScript 5, `strict`
- Tailwind CSS v4, shadcn/ui (Radix + lucide)
- Next-pipe (`@flefebvre/next-pipe`) for server entry points, zod 4 for validation
- Prisma 7 on SQLite, through the `@prisma/adapter-better-sqlite3` driver adapter
- Vitest 4, ESLint 9, Prettier 3 (sorts Tailwind classes)
- tsx, for the repo scripts

## Layout

```
src/
  app/          App Router; see docs/codebase/app-router.md for its conventions
  components/
    ui/         Shadcn-vendored, edit only through the CLI
  core/         Domain logic — discovery, parsing, accounting, pricing, search.
                Framework-free: no `next`/`react` imports (ADR-0002), ESLint enforces it
    __tests__/  Vitest suite and its sanitized JSONL fixtures
    prisma/     Schema, generated client, and migrations
  lib/          Shared helpers
scripts/        Repo tooling, run with tsx (the gate, seeding fake demo data)
data/           The local SQLite database (`analyzer.db`); generated, never hand-edit
docs/
  adr/          Architectural decision records
  codebase/     Conventions, one file per area, linked from the AGENTS.md section it governs
public/         Static assets served at the root
```

## Commands

```
pnpm dev           Run the app (next dev) on :3000
pnpm gate          Format check, lint, typecheck, test, build — the full check
pnpm format        Prettier, rewriting files in place
pnpm format:check  Prettier in check mode (fails on unformatted files)
pnpm lint          ESLint (includes the core boundary, ADR-0002)
pnpm typecheck     Next route typegen, then TypeScript with no emit
pnpm test          Vitest, once
pnpm test:watch    Vitest in watch mode
pnpm build         next build
```

**Before considering a change done:** run `pnpm gate`. It passed only if the output ends with `--gate OK--` — anything else is a failure, whatever the rest of the output says. The sequence is the `gate` line in package.json; add a check by adding its script name there.

## Testing

This project uses TDD. Build features test-first via the `tdd` skill (red → green → refactor, one vertical slice at a time), exercising public interfaces — `src/core`'s exported functions against small sanitized JSONL fixtures — never internals. See `docs/codebase/testing.md` before writing tests.

## Documentation

Always reach for documentation rather than working from memory. Prioritize the files below first, and then ctx7. Repo conventions live in `docs/codebase/`, linked from the section they govern; the sources below are external reference.

- `node_modules/next/dist/docs/01-app/` — when writing anything under `src/app/`. This Next.js has breaking changes your training data predates — read the relevant page first rather than recalling an older API. `03-api-reference/` is the per-feature reference.

## Comments and docs

An exported symbol should have a one-line JSDoc comment, and an `@example` where one is applicable — a call the caller could actually write. Write as though what you just changed had always been that way. Assume the reader knows everything you know, and write only what that leaves out.

## Language

Prose in this repo — docs, comments, commit messages, issues — is written in English, regardless of the language used in conversation.

## Agent skills

### Issue tracker

Issues are tracked in this repo's GitHub Issues via the `gh` CLI, labeled with the five canonical triage labels; external PRs are not a triage surface. See `docs/issue-tracker.md`.

### Domain docs

Single-context: one `CONTEXT.md` (the glossary — match test names and interface vocabulary to it) + `docs/adr/` at the repo root. See `docs/codebase/domain.md`.

## Keeping this file current

If your changes mandate an update to a section of this `AGENTS.md` file, make the change. Do not add any sections on your own. How this file and `docs/codebase/` are written: `docs/codebase/agent-docs.md`.
