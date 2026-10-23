#!/usr/bin/env tsx
/**
 * `pnpm smoke [--tarball <path>]`: the packaged app, as a user gets it. Installs
 * the tarball (by default `pnpm package`'s, `dist/claude-convo-analyzer-<version>.tgz`)
 * with plain npm into an empty temp directory outside the repo, then runs its
 * `claude-convo-analyzer` command on this machine's Node, against the core's
 * fixture logs and a scratch database and settings file:
 *
 *   - the installed package holds no native binding;
 *   - a launch with `--no-open --port` prints the version and the URL, and serves;
 *   - its startup Refresh fills the fresh database, and the Conversations list shows them;
 *   - a second launch on that port exits 0, and the first server still answers;
 *   - a launch with `PORT` on a port another program holds exits non-zero, naming `--port`.
 *
 * Node APIs only, no shell tools, so it runs the same on Linux, macOS and
 * Windows. Exits 0 when every step passed, else 1, naming the step.
 */
import { type ChildProcess, spawn } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:net";
import os from "node:os";
import path from "node:path";
import { parseArgs } from "node:util";

const repoRoot = path.resolve(import.meta.dirname, "..");
const { name: packageName, version } = JSON.parse(readFileSync(path.join(repoRoot, "package.json"), "utf-8")) as {
  name: string;
  version: string;
};

/** Conversations of the fixture logs root the list must show once the Refresh is done. */
const FIXTURE_LOGS_ROOT = path.join(repoRoot, "src", "core", "__tests__", "fixtures", "logs");
const EXPECTED_SESSION_IDS = ["sess-basic", "sess-multi"];

/** Long enough for a cold start and the fixture Refresh on a slow CI runner. */
const STEP_TIMEOUT_MS = 90_000;
const POLL_INTERVAL_MS = 250;

const { values: options } = parseArgs({ options: { tarball: { type: "string" } } });
const tarballPath = path.resolve(options.tarball ?? path.join(repoRoot, "dist", `${packageName}-${version}.tgz`));

class SmokeFailure extends Error {}

function check(condition: boolean, message: string): asserts condition {
  if (!condition) throw new SmokeFailure(message);
}

function step(title: string) {
  console.log(`\n▶ ${title}`);
}

/** `arg` quoted for cmd.exe when it holds a space: on Windows, npm is a .cmd that only runs through a shell. */
function shellSafe(arg: string) {
  return process.platform === "win32" && /\s/.test(arg) ? `"${arg}"` : arg;
}

/** Runs npm with `args` in `cwd`; resolves to its exit code, its output forwarded. */
function runNpm(args: string[], cwd: string): Promise<number> {
  const child = spawn("npm", args.map(shellSafe), { cwd, stdio: "inherit", shell: process.platform === "win32" });
  return new Promise((resolve) => {
    child.once("error", () => resolve(1));
    child.once("close", (code) => resolve(code ?? 1));
  });
}

/** A launcher run: its process, everything it printed so far, and its exit. */
type LauncherRun = { child: ChildProcess; output: () => string; exited: Promise<number> };

/** Starts the installed launcher with `args` and `env` added, its output echoed with a prefix. */
function startLauncher(launcherPath: string, args: string[], env: Record<string, string>, cwd: string): LauncherRun {
  const child = spawn(process.execPath, [launcherPath, ...args], {
    cwd,
    env: { ...process.env, ...env },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  const record = (chunk: Buffer) => {
    output += chunk.toString();
    for (const line of chunk.toString().split(/\r?\n/).filter(Boolean)) console.log(`  │ ${line}`);
  };
  child.stdout.on("data", record);
  child.stderr.on("data", record);
  const exited = new Promise<number>((resolve) => {
    child.once("error", () => resolve(1));
    child.once("close", (code) => resolve(code ?? 1));
  });
  return { child, output: () => output, exited };
}

/** Resolves once `condition` holds, polling; fails with `message` after {@link STEP_TIMEOUT_MS}. */
async function waitFor(condition: () => boolean | Promise<boolean>, message: string): Promise<void> {
  const deadline = Date.now() + STEP_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (await condition()) return;
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }
  throw new SmokeFailure(`${message} (after ${STEP_TIMEOUT_MS / 1000}s)`);
}

/** A loopback port nothing listens on right now. */
function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close(() => (typeof address === "object" && address ? resolve(address.port) : reject(new Error())));
    });
  });
}

/** A TCP server on loopback standing in for another program: it accepts and hangs up. */
function startOtherProgram(port: number): Promise<Server> {
  return new Promise((resolve, reject) => {
    const server = createServer((socket) => socket.destroy());
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => resolve(server));
  });
}

/** The body `url` answers, or `undefined` when it does not answer 200. */
async function fetchText(url: string): Promise<string | undefined> {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    return response.ok ? await response.text() : undefined;
  } catch {
    return undefined;
  }
}

/** Every file path under `dir`. */
function* filesUnder(dir: string): Generator<string> {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const entryPath = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* filesUnder(entryPath);
    else yield entryPath;
  }
}

async function smoke(workDir: string, cleanups: (() => void | Promise<void>)[]) {
  step(`Install ${tarballPath} with npm into ${workDir}`);
  check(existsSync(tarballPath), `no tarball at ${tarballPath}: run pnpm package first, or pass --tarball <path>`);
  writeFileSync(path.join(workDir, "package.json"), `${JSON.stringify({ name: "smoke", private: true })}\n`);
  check((await runNpm(["install", "--no-audit", "--no-fund", tarballPath], workDir)) === 0, "npm install failed");

  const packageDir = path.join(workDir, "node_modules", packageName);
  const installedManifest = JSON.parse(readFileSync(path.join(packageDir, "package.json"), "utf-8")) as {
    bin: Record<string, string>;
  };
  const launcherPath = path.join(packageDir, installedManifest.bin[packageName]);

  step("The package holds no native binding");
  const nativeFiles = [...filesUnder(packageDir)].filter((file) => file.endsWith(".node"));
  check(nativeFiles.length === 0, `native bindings shipped in the package: ${nativeFiles.join(", ")}`);

  const port = await freePort();
  const url = `http://127.0.0.1:${port}`;
  const dataDir = path.join(workDir, "data");
  const env = {
    CCA_LOGS_ROOT: FIXTURE_LOGS_ROOT,
    CCA_DB_PATH: path.join(dataDir, "analyzer.db"),
    CCA_SETTINGS_PATH: path.join(dataDir, "settings.json"),
  };

  step(`Launch with --no-open --port ${port}`);
  const server = startLauncher(launcherPath, ["--no-open", "--port", String(port)], env, workDir);
  cleanups.push(async () => {
    if (server.child.exitCode === null) {
      server.child.kill();
      await server.exited;
    }
  });
  let hasExited = false;
  void server.exited.then(() => (hasExited = true));
  await waitFor(() => {
    check(!hasExited, "the launcher exited before serving");
    return server.output().includes(`Serving at ${url}`);
  }, `the launcher never printed "Serving at ${url}"`);
  check(server.output().includes(`v${version}`), `the launcher did not print the version v${version}`);

  step("It answers as this app");
  const identity = JSON.parse((await fetchText(`${url}/api/identity`)) ?? "null") as unknown;
  check(
    JSON.stringify(identity) === JSON.stringify({ name: packageName, version }),
    `GET /api/identity answered ${JSON.stringify(identity)}`,
  );

  step("Its startup Refresh fills the fresh database, and the Conversations list shows them");
  await waitFor(
    async () => {
      const page = await fetchText(url);
      return page !== undefined && EXPECTED_SESSION_IDS.every((id) => page.includes(`/conversation/${id}`));
    },
    `the Conversations list never showed ${EXPECTED_SESSION_IDS.join(", ")}`,
  );
  const stylesheetPath = (await fetchText(url))?.match(/\/_next\/static\/[^"]+\.css/)?.[0];
  check(stylesheetPath !== undefined, "the page links no stylesheet");
  check((await fetchText(`${url}${stylesheetPath}`)) !== undefined, `${stylesheetPath} is not served`);

  step("A second launch on that port opens the running app and exits 0");
  const secondLaunch = startLauncher(launcherPath, ["--no-open", "--port", String(port)], env, workDir);
  check((await secondLaunch.exited) === 0, "the second launch did not exit 0");
  check(secondLaunch.output().includes(`Already running at ${url}`), "the second launch did not say it is running");
  check(!hasExited && (await fetchText(`${url}/api/identity`)) !== undefined, "the first server stopped answering");

  const otherPort = await freePort();
  step(`A launch with PORT=${otherPort}, held by another program, exits non-zero naming --port`);
  const otherProgram = await startOtherProgram(otherPort);
  cleanups.push(() => void otherProgram.close());
  const blockedLaunch = startLauncher(launcherPath, ["--no-open"], { ...env, PORT: String(otherPort) }, workDir);
  check((await blockedLaunch.exited) !== 0, "the launch on a port held by another program exited 0");
  check(blockedLaunch.output().includes("--port"), "the launch on a held port did not name --port");
}

async function main() {
  const workDir = mkdtempSync(path.join(os.tmpdir(), "cca-smoke-"));
  const cleanups: (() => void | Promise<void>)[] = [];
  let isPassing = true;
  try {
    await smoke(workDir, cleanups);
  } catch (error) {
    isPassing = false;
    console.error(`\nSmoke failed: ${error instanceof SmokeFailure ? error.message : String(error)}`);
    if (!(error instanceof SmokeFailure)) console.error(error);
  } finally {
    for (const cleanup of cleanups.reverse()) await cleanup();
    // Windows may hold a just-closed database file for a moment.
    rmSync(workDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 500 });
  }
  if (isPassing) console.log("\nSmoke passed: the packaged app installs, serves, and refuses as it should.");
  process.exit(isPassing ? 0 : 1);
}

void main();
