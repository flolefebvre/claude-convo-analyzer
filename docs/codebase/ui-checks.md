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

## README screenshot

Regenerate `docs/images/main-view.png` after a UI change it shows. Start
`PORT=<port> pnpm e2e:server` as in "Start the seeded app" (same seed, same
`Seeded app:` line), then:

```sh
pnpm exec playwright-cli -s=<worktree> open --config .playwright/readme-screenshot.config.json http://localhost:<port>
pnpm exec playwright-cli -s=<worktree> click "role=button[name='dev sub-folders']"
pnpm exec playwright-cli -s=<worktree> click "role=button[name='acme-api sub-folders']"
pnpm exec playwright-cli -s=<worktree> click "role=button[name='.claude/worktrees sub-folders']"
pnpm exec playwright-cli -s=<worktree> click "role=heading[name='Conversations']"
pnpm exec playwright-cli -s=<worktree> mousemove 0 0
pnpm exec playwright-cli -s=<worktree> screenshot --hires
cp .playwright-cli/<printed>.png docs/images/main-view.png
pnpm exec playwright-cli -s=<worktree> close
```

- `e2e:server`, not `dev:seed`: `next start` shows no dev indicator. Its build
  overwrites `.next/`; pick another port if an e2e run is going.
- The config is `.playwright/cli.config.json` plus a 1920×1182 viewport at
  device scale 2, like the other `docs/images/` captures; 1920 is the `2xl`
  sidebar width.
- 1182 ends the viewport on a table row's bottom border; re-measure if the
  chrome above the table changes height.
- The scope stays All folders, in light mode (headless Chrome's default); the
  three clicks open the tree down to `billing-spike` and `fix-auth-flake`, so
  the indent guides and share bars show.
- Clicking the heading moves focus off the last toggle, which would otherwise
  show its row's favorite star; `mousemove 0 0` leaves no row hovered.

## Run the e2e specs

`pnpm e2e` runs `e2e/*.spec.ts` (`docs/codebase/testing.md`, "End-to-end")
in headless Chromium. It starts and stops its own seeded app with
`pnpm e2e:server`, which seeds `data/seed/`, runs `next build` with the testing
API exposed (`EXPOSE_TESTING_API=1`), then runs `next start` on `$E2E_PORT`
(default `3123`). Because of the build, a run takes a minute or more. The
build overwrites `.next/`, the same directory `pnpm build` writes to.

It never reuses a running server: if the port is taken, the run fails. To run
two worktrees at once, give one of them a different `E2E_PORT`. The e2e server
reads its Recorder on `E2E_PORT` + 1000 (`e2e/ports.ts`), never on the host's 4242.

- Install the browser once per machine with
  `pnpm exec playwright install chromium`. This is `@playwright/test`'s
  Chromium, not the Chrome for Testing that `playwright-cli` uses.
- A failure writes a trace to the gitignored `test-results/`; open it with
  `pnpm exec playwright show-trace <path>`.
- Both `e2e:server` and `dev:seed` rebuild `data/seed/` every time they start.
  An e2e run and a manual `pnpm dev:seed` in the same worktree share that
  directory, so each start rebuilds it under the other.
- The lock behind `instant()` and the Navigation Inspector's "Pause on
  navigations" is the `next-instant-navigation-testing` cookie. Cookies are
  shared across ports on `localhost`, so in a manual browser with `:3000` and
  the seeded app both open, a pause in one also freezes navigations in the
  other. Playwright's specs aren't affected: each one starts in a fresh
  browser context.

## The empty state

`pnpm dev:seed` overrides `CCA_DB_PATH`. Once it is stopped, serve the app on
its port against a fresh database and an empty logs root, so Refresh stays
empty, again with `run_in_background: true` and stopped with `TaskStop`:

```sh
rm -rf data/empty && mkdir -p data/empty/logs && CCA_DB_PATH=data/empty/empty.db CCA_LOGS_ROOT=data/empty/logs pnpm dev -p <port>
```
