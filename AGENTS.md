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
pnpm seed          Rebuild the fake-data seed environment in data/seed/ (seed.db + projects/); --now=<ISO> pins it
pnpm dev:seed      Seed, then run next dev on it; prints `Seeded app: http://localhost:<port>` (first free from 3001, or $PORT)
pnpm check         Format check, lint, duplication, typecheck, then the tests affected since $CHECK_BASE (default origin/main) — the inner loop
pnpm gate          Format check, lint, duplication, typecheck, then test and build — the full check
pnpm format        Prettier, rewriting files in place
pnpm format:check  Prettier in check mode (fails on unformatted files)
pnpm lint          ESLint (includes the core boundary, ADR-0002)
pnpm duplication   jscpd copy-paste detection (config in .jscpd.json, fails on any clone)
pnpm typecheck     Next route typegen, then TypeScript with no emit
pnpm test          Vitest, once
pnpm test:changed  Vitest, once, only the tests affected since $CHECK_BASE (default origin/main)
pnpm test:watch    Vitest in watch mode
pnpm build         next build
```

## Verification

- check: `CHECK_BASE=origin/<base-branch> pnpm check`
- gate: `pnpm gate`
- final: ci

`<base-branch>` is the branch the change will merge into, `main` unless told otherwise. Run `check` after each step and each fix; it passed only if the output ends with `--check OK--`. A change is done when the pushed PR's `ci` check is green; a change that will not be pushed passes `pnpm gate` (ends with `--gate OK--`) once before it is handed over; later fixes re-run `check`, and CI re-validates the change when it is pushed. Any other ending is a failure, whatever the rest of the output says.

The `check` and `gate` lines in package.json are the sequences: `,` separates stages run in order, `+` joins scripts run in parallel. Never join two scripts that write the same files — `typecheck` and `build` both write `.next/types`. Add a check to the `gate` line and to the CI workflow, which runs one job per stage. See `docs/codebase/ci.md`.

## Worktrees

- Create and leave worktrees with the `EnterWorktree` and `ExitWorktree` tools, never with `git worktree add`.
- Run `git fetch` before creating one: a worktree starts from `origin/main`, not local `main`.
- In a new worktree, run `pnpm install` before anything else; it also generates the Prisma client.
- When a change touches the UI, check it in a browser against the seeded app, as `docs/codebase/ui-checks.md` describes.

## Testing

This project uses TDD. Build features test-first (red → green → refactor, one vertical slice at a time), exercising public interfaces — `src/core`'s exported functions against small sanitized JSONL fixtures — never internals. See `docs/codebase/testing.md` before writing tests.

## Documentation

Always reach for documentation rather than working from memory. Prioritize the files below first, and then ctx7. Repo conventions live in `docs/codebase/`, linked from the section they govern; the sources below are external reference.

- `node_modules/next/dist/docs/01-app/` — when writing anything under `src/app/`. This Next.js has breaking changes your training data predates — read the relevant page first rather than recalling an older API. `03-api-reference/` is the per-feature reference.
- `node_modules/@flefebvre/next-pipe/docs/for-agents.md` — when writing a server action, route handler, or piped page. It matches the installed next-pipe and links the per-pipe pages.

## Comments and docs

An exported symbol should have a one-line JSDoc comment, and an `@example` where one is applicable — a call the caller could actually write. Write as though what you just changed had always been that way. Assume the reader knows everything you know, and write only what that leaves out.

## Language

Prose in this repo — docs, comments, commit messages, issues — is written in English, regardless of the language used in conversation.

## Agent skills

### Issue tracker

Issues are tracked in this repo's GitHub Issues via the `gh` CLI; external PRs are not a triage surface. See `docs/issue-tracker.md`.

### Triage labels

The five canonical triage labels, each named after its role. See `docs/triage-labels.md`.

### Domain docs

Single-context: one `GLOSSARY.md` (the glossary — match test names and interface vocabulary to it) + `docs/adr/` at the repo root. See `docs/codebase/domain.md`.

## Keeping this file current

If your changes mandate an update to a section of this `AGENTS.md` file, make the change. Do not add any sections on your own. How this file and `docs/codebase/` are written: `docs/codebase/agent-docs.md`.
