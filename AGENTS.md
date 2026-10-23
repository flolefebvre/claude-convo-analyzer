## Context

`claude-convo-analyzer` is a local-only web app that reads the Claude Code conversation logs on this machine (`~/.claude/projects/`), parses them deterministically into a SQLite database, and presents analysis — per-conversation token usage and cost first. Everything runs locally; there is no server, auth, or telemetry.

## Stack

- Next.js 16.4 (App Router, Cache Components), React 19.3 with the React Compiler
- TypeScript 5, `strict`
- Tailwind CSS v4, shadcn/ui (Radix + lucide)
- Next-pipe (`@flefebvre/next-pipe`) for server entry points, zod 4 for validation
- next-sse (`@flefebvre/next-sse`, in-memory transport) for the live Refresh progress on every page
- Prisma 7 on SQLite, through the `@prisma/adapter-better-sqlite3` driver adapter, for the schema, migrations and reads; the Refresh writes through bare better-sqlite3 (ADR-0005)
- Vitest 4, ESLint 10, Prettier 3 (sorts Tailwind classes)
- Playwright (`@playwright/test` + `@next/playwright`), for the e2e specs
- tsx, for the repo scripts

## Layout

```
src/
  app/          App Router; see docs/codebase/app-router.md for its conventions
  components/
    ui/         Shadcn-vendored, edit only through the CLI; then point a bare `cn` import
                at @/lib/utils-cn (no `cn` package)
  core/         Domain logic — discovery, parsing, accounting, pricing, search.
                Framework-free: no `next`/`react` imports (ADR-0002), ESLint enforces it
    __tests__/  Vitest suite and its sanitized JSONL fixtures
    prisma/     Schema, generated client, and migrations
  generated/    Typed route builders from `pnpm gen`; generated, gitignored, never hand-edit
  launcher/     The npm package's `claude-convo-analyzer` command (ADR-0009): pure decisions, tested beside
                them, and a thin I/O edge. Compiled to CommonJS by `pnpm package`, run by the user's Node.
                Imports only `node:` and its own files, ESLint enforces it
  lib/          Shared helpers
e2e/            Playwright specs, one per route, plus the shared-state ones run after them (docs/codebase/testing.md)
scripts/        Repo tooling, run with tsx (the gate, seeding fake demo data, the npm package and its smoke, the release tag check)
data/           The seed environment (`data/seed/`) and scratch databases; generated, never hand-edit.
                The app's own database lives in ~/.claude-convo-analyzer/
dist/           The npm package (`dist/claude-convo-analyzer/`) and its tarball, from `pnpm package`; generated, gitignored
docs/
  adr/          Architectural decision records
  codebase/     Conventions, one file per area, linked from the AGENTS.md section it governs
```

## Commands

```
pnpm dev           Run the app (next dev) on :3000
pnpm seed          Rebuild the fake-data seed environment in data/seed/ (seed.db + projects/); --now=<ISO> pins it
pnpm gen           Regenerate the typed route builders in src/generated/routes/ (next-pipe gen); run after adding, moving or removing a route
pnpm dev:seed      Seed, then run next dev on it; prints `Seeded app: http://localhost:<port>` (first free from 3001, or $PORT)
pnpm e2e:server    Seed, then next build with the testing API exposed and next start on it ($PORT, as dev:seed) — what pnpm e2e serves
pnpm bench:refresh Cold Refresh of $CCA_LOGS_ROOT (default ~/.claude/projects) into a scratch DB; prints phase split, peak live heap (forced GC before each sample) and where it was, longest stall. Not in check/gate/CI
pnpm check         Format check, lint, duplication, typecheck, then the tests affected since $CHECK_BASE (default origin/main) — the inner loop
pnpm gate          Format check, lint, duplication, typecheck, then test and build, then e2e, then package and smoke — the full check
pnpm format        Prettier, rewriting files in place
pnpm format:check  Prettier in check mode (fails on unformatted files)
pnpm lint          ESLint (includes the core boundary, ADR-0002)
pnpm duplication   jscpd copy-paste detection (config in .jscpd.json, fails on any clone; skips migrations, which are immutable once applied)
pnpm typecheck     Next route typegen, then TypeScript with no emit
pnpm test          Vitest, once
pnpm test:changed  Vitest, once, only the tests affected since $CHECK_BASE (default origin/main)
pnpm test:watch    Vitest in watch mode
pnpm build         next build; fails on any Turbopack warning (scripts/build.ts)
pnpm e2e           Playwright instant-navigation specs against its own e2e:server on :3123 (or $E2E_PORT)
pnpm package       Standalone next build, assembled into the npm package in dist/claude-convo-analyzer/, packed beside it; prints the tarball's path
pnpm smoke         npm-installs the packed tarball (or --tarball <path>) in a temp directory and drives its launcher on fixture logs
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

This project uses TDD. Build features test-first (red → green → refactor, one vertical slice at a time), exercising public interfaces — `src/core`'s exported functions against small sanitized JSONL fixtures — never internals. See `docs/codebase/testing.md` before writing tests. Each route also gets a Playwright `instant()` spec in `e2e/`, covering what its static shell shows (same file, "End-to-end").

## Naming

Every name passes the test in `docs/codebase/naming.md`; read it before naming or renaming anything.

## Documentation

Always reach for documentation rather than working from memory. Prioritize the files below first, and then ctx7. Repo conventions live in `docs/codebase/`, linked from the section they govern; the sources below are external reference.

- `node_modules/next/dist/docs/01-app/` — when writing anything under `src/app/`. This Next.js has breaking changes your training data predates — read the relevant page first rather than recalling an older API. `03-api-reference/` is the per-feature reference.
- `node_modules/@flefebvre/next-pipe/docs/for-agents.md` — when writing a server action, route handler, or piped page. It matches the installed next-pipe and links the per-pipe pages.
- `node_modules/@flefebvre/next-sse/docs/index.md` — when touching a Channel, a publish, the SSE route, or a component that subscribes. It is the manual for the installed next-sse.

## Comments and docs

An exported symbol should have a one-line JSDoc comment, and an `@example` where one is applicable — a call the caller could actually write. Write as though what you just changed had always been that way. Assume the reader knows everything you know, and write only what that leaves out.

Before handing over an issue's change, reread `README.md` and update it when the change adds, removes or alters something a user sees or runs — a page, a feature, a command, an environment variable, a requirement.

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
