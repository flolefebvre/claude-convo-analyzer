# UI checks

Check a UI change in a real browser with `playwright-cli` (the `@playwright/cli`
devDependency) against the seeded app. Run every command from the worktree
root.

## Start the seeded app

- Start `pnpm dev:seed` with the Bash tool's `run_in_background: true`, then
  read its output file until the `Seeded app: http://localhost:<port>` line
  appears; that URL is the app.
- Stop it with `TaskStop` on that background task: `kill` on the `pnpm` pid
  orphans `next dev`, which keeps the port.

## Drive the browser

Name the session `<worktree>`, the worktree directory's name (e.g. `issue-72`),
so concurrent agents never share a browser; spell it out, since a worktree
session refuses `pnpm` commands carrying `$(...)`:

```sh
pnpm exec playwright-cli -s=<worktree> open http://localhost:<port>
pnpm exec playwright-cli -s=<worktree> snapshot          # accessibility tree, with [ref=eN] refs
pnpm exec playwright-cli -s=<worktree> find "<text>"     # snapshot nodes matching the text
pnpm exec playwright-cli -s=<worktree> click e31         # a ref from the latest snapshot
pnpm exec playwright-cli -s=<worktree> screenshot        # prints the .png path; view it with Read
pnpm exec playwright-cli -s=<worktree> close
```

- Omit `screenshot --filename`: it writes relative to the cwd, into the repo;
  the default lands in the gitignored `.playwright-cli/`, with the snapshots and
  console logs.
- `pnpm exec playwright-cli --help <command>` lists a command's options.
- `close` ends the session's daemon and browser; nothing persists, and
  `pnpm exec playwright-cli list` then prints `(no browsers)`.
- `open` launches Playwright's bundled Chrome for Testing, pinned by
  `.playwright/cli.config.json`. If it fails with
  `Browser "chrome-for-testing" is not installed`, run
  `pnpm exec playwright-cli install-browser chrome-for-testing` (into the user
  cache, no sudo).

## The empty state

`pnpm dev:seed` overrides `CCA_DB_PATH`. Once it is stopped, serve the app on
its port against a fresh database and an empty logs root, so Refresh stays
empty, again with `run_in_background: true` and stopped with `TaskStop`:

```sh
rm -rf data/empty && mkdir -p data/empty/logs && CCA_DB_PATH=data/empty/empty.db CCA_LOGS_ROOT=data/empty/logs pnpm dev -p <port>
```
