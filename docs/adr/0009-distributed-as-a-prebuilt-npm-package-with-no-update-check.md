# Distributed as a prebuilt npm package, with no update check

## Status

accepted

## Context

Running the app used to mean cloning the repo, installing with pnpm and
building it: minutes of a toolchain most users of Claude Code have no reason to
own. They all have Node, so npm and `npx`. The app must stay local-only:
nothing is ever sent anywhere, so no update check either.

## Decision

- **The app ships as the npm package `claude-convo-analyzer`, run with
  `npx claude-convo-analyzer@latest`**, which is also how it updates. The clone
  is for contributors only.
- **The package is prebuilt**: Next's standalone output, its static assets and
  the Prisma migrations, so the user's machine never builds. `pnpm package`
  assembles it, with a generated manifest instead of the repo's, which carries
  dev tooling and a `postinstall` that would fail there.
- **The native SQLite binding is never shipped.** better-sqlite3 is the
  package's one dependency, so npm installs the binding built for the user's
  platform and Node; the app finds it by walking up from its own directory.
- **A launcher, the package's command,** checks the Node version first, serves
  on `127.0.0.1:4747` (loopback only, a fixed port so bookmarks keep working),
  opens the browser, and turns a second launch into opening the running app,
  which it recognises by a loopback `GET /api/identity`.
- **No update check, and Next telemetry off.** The app bar shows the running
  version; updating is running `@latest` again.

## Considered options

- **Keep the clone and build as the way to run it**: rejected. It asks every
  user for pnpm and a build, for an app they only want to run.
- **Install the full dependency tree from npm at install time** (next, react,
  the Prisma packages as dependencies, then build or start there): rejected.
  It downloads Next's compiler binaries and far more than the standalone trace
  holds, for every user and every update.
- **Ship the binding prebuilt for each platform** in the package: rejected. It
  multiplies the package by every platform and Node ABI, and still misses some.
- **Check for updates at startup**: rejected. It is a request to a third party,
  which the local-only promise rules out.

## Consequences

- `pnpm package` depends on how Next lays out a pnpm install's standalone trace
  and names its external aliases; a Next or pnpm upgrade can break it.
  `scripts/package.ts` fails, naming the assumption, when it can tell, and the
  `smoke` stage installs and runs the packed tarball on every change.
- On a Node older than 20, npm warns that the package needs Node 20.9 or newer
  (`EBADENGINE`), then usually fails building better-sqlite3, before the
  launcher can print its own one-line answer; Node 20.0 to 20.8 gets that answer.
- Users run whatever version they last fetched until they run `@latest` again;
  the app never tells them a newer one exists.
