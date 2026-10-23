// The launcher's I/O edge, loaded by `bin.ts` once Node is known recent
// enough. It reads the command line, probes the port, then either serves the
// packaged app in this very process or hands over to the copy already serving.
// Serving in-process means stopping the launcher (Ctrl+C, or a kill on Windows,
// which runs no handler) stops the server with it.
//
// Compiled to CommonJS into the package's `bin/`, beside the generated
// package.json's parent: `<package>/bin/launch.js`, `<package>/app/server.js`.

import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { createServer } from "node:net";
import path from "node:path";

import { browserOpenCommand } from "./browser-command";
import { LAUNCH_USAGE, parseLaunchArguments } from "./launch-arguments";
import { classifyPort } from "./port-holder";

/** The only interface the app binds, probes and opens: it is never reachable from the network. */
const LOOPBACK_HOST = "127.0.0.1";

/** How long the launcher waits for a held port's identity answer. */
const IDENTITY_TIMEOUT_MS = 2000;

/** How long a starting server may take to answer before the launch fails. */
const READY_TIMEOUT_MS = 60_000;

/** Pause between two readiness polls of a starting server. */
const READY_POLL_INTERVAL_MS = 200;

/** The environment variables naming a path, resolved by the app against its cwd, which `server.js` moves. */
const PATH_VARIABLES = ["CCA_DB_PATH", "CCA_LOGS_ROOT", "CCA_SETTINGS_PATH"] as const;

/** Whether `port` can be bound on loopback right now; rejects on any error but the port being in use. */
function isPortBindable(port: number): Promise<boolean> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", (error: NodeJS.ErrnoException) =>
      error.code === "EADDRINUSE" ? resolve(false) : reject(error),
    );
    server.listen(port, LOOPBACK_HOST, () => server.close(() => resolve(true)));
  });
}

/** The parsed JSON `url`'s server answers `GET /api/identity` with, or `undefined` when it gives none. */
async function fetchIdentity(url: string): Promise<unknown> {
  try {
    const response = await fetch(`${url}/api/identity`, { signal: AbortSignal.timeout(IDENTITY_TIMEOUT_MS) });
    return response.ok ? await response.json() : undefined;
  } catch {
    return undefined;
  }
}

/** Resolves once the server at `url` answers its identity, or to `false` after {@link READY_TIMEOUT_MS}. */
async function waitUntilServing(url: string): Promise<boolean> {
  const deadline = Date.now() + READY_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if ((await fetchIdentity(url)) !== undefined) return true;
    await new Promise((resolve) => setTimeout(resolve, READY_POLL_INTERVAL_MS));
  }
  return false;
}

/** Opens `url` in the default browser, detached; prints where to go when no browser could be started. */
function openBrowser(url: string): Promise<void> {
  const { command, args } = browserOpenCommand(process.platform, url);
  const printFallback = () => console.log(`Could not open a browser: open ${url} yourself.`);
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      detached: true,
      stdio: "ignore",
      // `cmd /c start ""` needs its empty title passed as is, not escaped.
      windowsVerbatimArguments: process.platform === "win32",
    });
    child.once("error", () => {
      printFallback();
      resolve();
    });
    child.once("exit", (code) => {
      if (code !== 0) printFallback();
    });
    child.once("spawn", () => {
      child.unref();
      resolve();
    });
  });
}

/**
 * Run the launcher for the package at `packageRoot` (by default the one this
 * compiled file sits in): serve the app on loopback, or open the copy already
 * serving, or explain why it cannot. Sets `process.exitCode` to 1 on any
 * refusal; a served app runs until stopped.
 *
 * @example await launch(); // from `bin/claude-convo-analyzer.js`
 */
export async function launch(packageRoot: string = path.resolve(__dirname, "..")): Promise<void> {
  const manifest = JSON.parse(readFileSync(path.join(packageRoot, "package.json"), "utf-8")) as {
    name: string;
    version: string;
  };
  const request = parseLaunchArguments(process.argv.slice(2), process.env);
  if (request.kind === "help") {
    console.log(LAUNCH_USAGE);
    return;
  }
  if (request.kind === "invalid") {
    console.error(`${request.message}\n\n${LAUNCH_USAGE}`);
    process.exitCode = 1;
    return;
  }

  console.log(`Claude Conversation Analyzer v${manifest.version}`);
  const { port, shouldOpenBrowser } = request;
  const url = `http://${LOOPBACK_HOST}:${port}`;

  let isBindable: boolean;
  try {
    isBindable = await isPortBindable(port);
  } catch (error) {
    console.error(`Cannot serve on port ${port} (${(error as NodeJS.ErrnoException).code ?? String(error)}).`);
    process.exitCode = 1;
    return;
  }
  const holder = classifyPort(
    { isBindable, identity: isBindable ? undefined : await fetchIdentity(url) },
    manifest.name,
  );

  if (holder.kind === "another program") {
    console.error(
      `Port ${port} is in use by another program. Run claude-convo-analyzer --port <number> to serve on another port.`,
    );
    process.exitCode = 1;
    return;
  }
  if (holder.kind === "this app") {
    const otherVersion = holder.version === manifest.version ? "" : ` (v${holder.version}; stop it to run this one)`;
    console.log(`Already running at ${url}${otherVersion}.`);
    if (shouldOpenBrowser) await openBrowser(url);
    return;
  }

  for (const name of PATH_VARIABLES) {
    const value = process.env[name];
    if (value) process.env[name] = path.resolve(value);
  }
  process.env.PORT = String(port);
  process.env.HOSTNAME = LOOPBACK_HOST;
  process.env.NEXT_TELEMETRY_DISABLED = "1";
  // Starts Next's standalone server in this process; it chdirs to `app/`.
  createRequire(path.join(packageRoot, "package.json"))(path.join(packageRoot, "app", "server.js"));

  if (!(await waitUntilServing(url))) {
    console.error(`The server did not answer at ${url} within ${READY_TIMEOUT_MS / 1000}s.`);
    process.exit(1);
  }
  console.log(`Serving at ${url} (press Ctrl+C to stop).`);
  if (shouldOpenBrowser) await openBrowser(url);
}
