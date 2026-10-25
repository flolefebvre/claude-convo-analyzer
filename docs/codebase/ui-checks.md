# UI checks

Check a UI change in a real browser with `playwright-cli` (the `@playwright/cli`
devDependency) against the seeded app. Run every command from the worktree
root.

## Start the seeded app

- Start `pnpm dev:seed` with the Bash tool's `run_in_background: true`, then
  read its output file until the `Seeded app: http://127.0.0.1:<port>` line
  appears; that URL is the app.
- Stop it with `TaskStop` on that background task: `kill` on the `pnpm` pid
  orphans `next dev`, which keeps the port.

## Drive the browser

Name the session `<worktree>`, the worktree directory's name (e.g. `issue-72`),
so concurrent agents never share a browser; spell it out, since a worktree
session refuses `pnpm` commands carrying `$(...)`:

```sh
pnpm exec playwright-cli -s=<worktree> open http://127.0.0.1:<port>
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

## README screenshots

Regenerate an image in `docs/images/` after a UI change it shows. Start
`PORT=<port> pnpm e2e:server` as in "Start the seeded app" (same seed, same
`Seeded app:` line), then:

```sh
pnpm exec playwright-cli -s=<worktree> open --config .playwright/readme-screenshot.config.json http://127.0.0.1:<port>
# then, for each image in the list below:
pnpm exec playwright-cli -s=<worktree> goto "http://127.0.0.1:<port><path>"
pnpm exec playwright-cli -s=<worktree> resize 1920 <height>
# the image's clicks, if any
pnpm exec playwright-cli -s=<worktree> mousemove 0 0
pnpm exec playwright-cli -s=<worktree> screenshot --hires
cp .playwright-cli/<printed>.png docs/images/<image>.png
# once every image is taken:
pnpm exec playwright-cli -s=<worktree> close
```

- `e2e:server`, not `dev:seed`: `next start` shows no dev indicator. Its build
  overwrites `.next/`; pick another port if an e2e run is going.
- The config is `.playwright/cli.config.json` plus a 1920×1182 viewport at
  device scale 2; 1920 is the `2xl` sidebar width. `resize` sets the viewport
  and keeps the scale, so an image is 3840 px wide and twice its height tall.
- Every image is the visible viewport, never `--full-page`. Its height is the
  smallest from 1182 up that ends on a clean edge: a table row's or an expanded
  panel's bottom border, or the gap between two cards. Re-measure, on a taller
  `resize`, when what is above that edge changes height.
- Every image is in light mode (headless Chrome's default) and All folders,
  with the tree as it opens unless the image's clicks say otherwise.
  `mousemove 0 0` leaves no row hovered.
- The seed's titles, session ids and order don't depend on the instant it is
  built; only the dates do. A seeded session id embeds the home directory:
  `<home>` below is `$HOME` with every `/` and `.` turned into `-`, without
  the leading one (`home-alice` for `/home/alice`).
- View each PNG before committing it: the paragraph above it in `README.md`
  says what it must show.

The images, each with its height, path and subject:

- `main-view.png` — 1182, `/`. Clicks
  `"role=button[name='dev sub-folders']"`,
  `"role=button[name='acme-api sub-folders']"` and
  `"role=button[name='.claude/worktrees sub-folders']"`, opening the tree down
  to `billing-spike` and `fix-auth-flake` so the indent guides and share bars
  show, then `"role=heading[name='Conversations']"`: it moves focus off the
  last toggle, which would otherwise show its row's favorite star.
- `conversation-detail.png` — 1206,
  `/?sortBy=cost&dir=desc&expanded=seed-<home>-dev-web-dashboard-13`.
  Sorted by cost, "Debug the memory leak in the worker" (web-dashboard) is
  expanded: three models, the `tdd` skill, and the general-purpose and Plan
  sub-agents. The frame ends on the next row's bottom border.
- `continuation-family.png` — 1292,
  `/?expanded=seed-<home>-dev-acme-api-31`. "Billing split — extract the
  invoice writer" is expanded: the five-conversation family tree, with it
  highlighted and the worktree sitting labelled `billing-spike`. The frame ends
  on the panel's bottom border.
- `api-errors.png` — 1184,
  `/?errors=1&expanded=seed-<home>-dev-web-dashboard-43`. With "Only with
  errors" on, the higher of the two web-dashboard "Containerize the service"
  rows (2 errors) is expanded: one failure in main, one in a general-purpose
  sub-agent.
- `transcript-view.png` — 1216,
  `/conversation/seed-<home>-dev-docs-site-60`. The Transcript of
  "Coordinate the search rewrite across agents", on main, with its Plan Agent
  call opened by `click "summary:has-text('plan the change')"`: the Task
  prompt and what Plan handed back, as Markdown. The frame ends in the gap
  below a message.
- `tools-view.png` — 1204, `/tools?expanded=Bash`. The Tools page over 30
  days, with Bash expanded: its most recent errors and largest results. The
  frame ends on the table's bottom border.
- `search-view.png` — 1319, `/search?q=%22auth+middleware%22`. The results
  for the quoted phrase `"auth middleware"`: highlighted extracts across
  several conversations, down to the "Refactor auth middleware" card, whose
  title matches too. The frame ends in the gap below that card. The Search
  page has no sidebar.

## Run the e2e specs

`pnpm e2e` runs `e2e/*.spec.ts` (`docs/codebase/testing.md`, "End-to-end")
in headless Chromium. It starts and stops its own seeded app with
`pnpm e2e:server`, which seeds `data/seed/`, runs `next build` with the testing
API exposed (`EXPOSE_TESTING_API=1`), then runs `next start` on `$E2E_PORT`
(default `3123`). Because of the build, a run takes a minute or more. The
build overwrites `.next/`, the same directory `pnpm build` writes to.

It never reuses a running server: if the port is taken, the run fails. To run
two worktrees at once, give one of them a different `E2E_PORT`.

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
  shared across ports on the same host (`127.0.0.1`), so in a manual browser with `:3000` and
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
