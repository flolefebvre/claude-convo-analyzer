# UI checks

Check a UI change in a real browser with `playwright-cli` (the `@playwright/cli`
devDependency) against the seeded app. Run every command from the worktree
root.

## Start the seeded app

- Start `pnpm dev:seed` with the Bash tool's `run_in_background: true`, then
  read its output file for the `Seeded app: http://localhost:<port>` line; that
  URL is the app.
- Stop it with `TaskStop` on that background task: `kill` on the `pnpm` pid
  orphans `next dev`, which keeps the port.

## Drive the browser

Name the session after the worktree, so concurrent agents never share a
browser:

```sh
pnpm exec playwright-cli -s=$(basename "$PWD") open http://localhost:<port>
pnpm exec playwright-cli -s=$(basename "$PWD") snapshot          # accessibility tree, with [ref=eN] refs
pnpm exec playwright-cli -s=$(basename "$PWD") find "<text>"     # snapshot nodes matching the text
pnpm exec playwright-cli -s=$(basename "$PWD") click e31         # a ref from the latest snapshot
pnpm exec playwright-cli -s=$(basename "$PWD") screenshot        # prints the .png path; view it with Read
pnpm exec playwright-cli -s=$(basename "$PWD") close
```

- Omit `screenshot --filename`: it writes relative to the cwd, into the repo;
  the default lands in the gitignored `.playwright-cli/`, with the snapshots and
  console logs.
- `pnpm exec playwright-cli --help <command>` lists a command's options.
- If `playwright-cli` complains about a missing browser, run
  `pnpm exec playwright-cli install-browser chromium`.

## The empty state

`pnpm dev:seed` overrides `CCA_DB_PATH`. Once it is stopped, serve the app on
its port against a fresh database and an empty logs root, so Refresh stays
empty, again with `run_in_background: true` and stopped with `TaskStop`:

```sh
rm -rf data/empty && mkdir -p data/empty/logs && CCA_DB_PATH=data/empty/empty.db CCA_LOGS_ROOT=data/empty/logs pnpm dev -p <port>
```
