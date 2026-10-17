# CI

`.github/workflows/ci.yml` runs on every pull request, whatever its base branch, and every push to `main`. A superseded run on the same ref is cancelled, except on `main`, where every push keeps its run. Its jobs run in parallel: `static`, `test`, `build`, `e2e`, then `ci`, which waits for the other four.

- Give each stage of the `gate` line in package.json its own job, and each script in it its own step, in the gate's order, so a failing check names itself in the run summary.
- Keep the summary job named `ci`: it is the one status check a branch ruleset requires, so a renamed job blocks every merge. Add every new job to its `needs`, and keep its `if: ${{ !cancelled() }}` and its check that every needed job succeeded — a required check that is skipped counts as passing, so without them a failed job would leave a mergeable PR.
- Split the test suite by adding a number to the `test` job's `shard` list when that job becomes the longest one; the shard count is read from the list.
- Restore caches only for tools that reuse them across runs, and place them after the install. The incremental caches — `node_modules/.cache` (Prettier, ESLint) and `tsconfig.tsbuildinfo` in `static`, `.next/cache` in `build` — are keyed on the lockfile and the commit, and restored from the latest key with the same lockfile. The Playwright browsers in `e2e` (`~/.cache/ms-playwright`) are keyed on the runner OS and the installed `@playwright/test` version (`hashFiles` on its `package.json`), not the lockfile, so an unrelated dependency bump keeps the download; they have no restore-keys, since a browser built for another Playwright version is never used.
- The `e2e` job restores the Playwright browsers, then on a hit installs only Chromium's OS packages
  (`pnpm exec playwright install-deps chromium`), which the cache does not hold, and on a miss installs the
  browser with them (`pnpm exec playwright install --with-deps chromium`). It then runs `pnpm e2e`. That builds
  its own test build (`EXPOSE_TESTING_API=1`) and serves it seeded; it never reuses the `build` job's output. If
  the job fails, it uploads `playwright-report/` as an artifact for 7 days, the only way to debug a failure that
  happens only on CI.
- Put a step every job needs in `.github/actions/setup`, the composite action each job calls right after checkout, never copied into the jobs.
- Pin `node-version` to the major the repo is developed on, never a range that lets CI drift onto a major nobody has run.
- Keep `pnpm/action-setup` ahead of `actions/setup-node`, which needs pnpm on the PATH for `cache: pnpm`. It takes no `version` input: pnpm resolves from the `packageManager` pin in package.json.

Before pushing a change to the workflow, lint it with `docker run --rm -v "$PWD:/repo" -w /repo rhysd/actionlint:latest`.
