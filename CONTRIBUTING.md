# Contributing

Found a bug or have an idea? Open an issue. This page is for working on the
app itself; to use it, see the [README](README.md).

Developing the app needs macOS, Linux or WSL, with
[Node.js](https://nodejs.org) 22 or newer and [pnpm](https://pnpm.io).

## Running from a clone

```bash
git clone https://github.com/flolefebvre/claude-convo-analyzer.git
cd claude-convo-analyzer
pnpm install      # also generates the Prisma client (postinstall)
pnpm dev
```

Then open [http://127.0.0.1:3000](http://127.0.0.1:3000) (loopback only, never
on your network). For a production build instead of live development:

```bash
pnpm build
pnpm start
```

The app reads and writes the same files as the published package — your real
`~/.claude/projects` logs and `~/.claude-convo-analyzer/` database and settings
— unless `CCA_DB_PATH`, `CCA_LOGS_ROOT` or `CCA_SETTINGS_PATH` move them (see
the README). Under `pnpm`, a relative value resolves against the repo root:

```bash
CCA_DB_PATH=data/demo.db CCA_LOGS_ROOT=/tmp/demo-logs pnpm dev
```

## Checks

The validation gate — format check, lint, duplication and typecheck in
parallel, then test and build in parallel, then the Playwright end-to-end specs,
then `pnpm package` and `pnpm smoke`, which installs the packed tarball with npm
outside the repo and drives its launcher; it passed only if the output ends with
`--gate OK--`. `pnpm check` is the faster inner loop: the same static checks,
then only the tests affected since `origin/main` (`--check OK--`):

```bash
pnpm check
pnpm gate
```

The end-to-end specs need Chromium, installed once with
`pnpm exec playwright install chromium`.

See [`docs/codebase/testing.md`](docs/codebase/testing.md) for the testing
approach and fixtures.

## Demo data

`pnpm seed` builds a self-contained seed environment in `data/seed/`: invented
logs in `data/seed/projects/`, ingested into `data/seed/seed.db`. Each run wipes
and rebuilds that directory; your real database and logs are never read or
written. On Windows, the seed and `linked-sub-agent.test.ts` create symlinks,
which need Developer Mode or an elevated shell: without either, `symlinkSync`
fails with EPERM. To seed and serve the app on it in one step:

```bash
pnpm dev:seed
```

It prints `Seeded app: http://127.0.0.1:<port>` — the first free port from
3001, or `PORT` when set — so several checkouts can each run their own. Refresh
in that app re-reads only the seeded logs, and `CCA_SETTINGS_PATH` points at
`data/seed/settings.json`, so Live starts off with three seeded favorites, and
your own settings are never touched.

The seeded activity ends now. `pnpm seed` also takes `--now=<ISO>`, and the same
`--now` always yields the same data, which is what screenshots want; point the
app at that seed with `CCA_DB_PATH` and `CCA_LOGS_ROOT`:

```bash
pnpm seed --now=2026-06-22T17:00:00Z
CCA_DB_PATH=data/seed/seed.db CCA_LOGS_ROOT=data/seed/projects pnpm dev
```

## Testing the package before a release

Users run the npm package with `npx claude-convo-analyzer@latest`. To try a
package built from your clone before it is released, pack it and run its
tarball:

```bash
pnpm package    # prints the tarball's path: dist/claude-convo-analyzer-<version>.tgz
npx ./dist/claude-convo-analyzer-<version>.tgz
```

It behaves as the published command does, flags and environment variables
included, a relative value resolving against the directory you run it from.
