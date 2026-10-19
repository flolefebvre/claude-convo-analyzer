// What `pnpm dev:seed` and `pnpm e2e:server` share: rebuild the seed environment
// in `data/seed/` (timeline ending now), pick the port, then run their Next
// commands one after another against the seed, with `CCA_DB_PATH`,
// `CCA_LOGS_ROOT`, `CCA_RECORDINGS_ROOT` and `CCA_SETTINGS_PATH` pointing at it
// so the app reads only the fake logs and Recordings, and never reads or writes
// the user's settings.
//
// The port is `PORT` when set, else the first free one from 3001, so several
// worktrees can each serve their own seeded app at once. The URL is printed as
// one `Seeded app: http://localhost:<port>` line before the last command starts.

import { type ChildProcess, spawn } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";

import { seedEnvironment } from "../seed/environment";
import { findFreePort } from "./free-port";

const FIRST_PORT = 3001;

/** `PORT` as a valid TCP port, or `undefined` when unset or empty. */
function explicitPort(): number | undefined {
  const raw = process.env.PORT;
  if (!raw) return undefined;
  const port = Number(raw);
  if (!/^\d+$/.test(raw) || port < 1 || port > 65535) {
    throw new Error(`PORT: expected an integer from 1 to 65535, got "${raw}"`);
  }
  return port;
}

/** Runs `next <args>` with `env` added; resolves to its exit code. */
function runNext(args: string[], env: Record<string, string>, onSpawn: (child: ChildProcess) => void): Promise<number> {
  const nextBin = createRequire(import.meta.url).resolve("next/dist/bin/next");
  const child = spawn(process.execPath, [nextBin, ...args], { stdio: "inherit", env: { ...process.env, ...env } });
  onSpawn(child);
  return new Promise((resolve) => child.on("close", (code) => resolve(code ?? 1)));
}

/**
 * Seed, then run each `next` command in turn against the seed; the last one is
 * the server, and the process exits with its code. An earlier command that
 * fails ends the run with its code.
 *
 * @example
 * serveSeeded({ commands: (port) => [["dev", "-p", String(port)]] });
 */
export function serveSeeded(opts: {
  /** Each command's `next` arguments, given the chosen port. */
  commands: (port: number) => string[][];
  /** Added to every command's environment. */
  env?: Record<string, string>;
}): void {
  main(opts).catch((err: unknown) => {
    console.error(err);
    process.exit(1);
  });
}

async function main({ commands, env = {} }: Parameters<typeof serveSeeded>[0]): Promise<void> {
  const requested = explicitPort();

  const seed = await seedEnvironment({ dir: path.resolve("data", "seed"), now: new Date() });
  const { conversations, subAgents, projects } = seed.generated;
  console.log(`Seeded ${conversations} conversations (${subAgents} sub-agents) across ${projects} projects.`);

  const port = requested ?? (await findFreePort(FIRST_PORT));
  const seededEnv = {
    ...env,
    CCA_DB_PATH: seed.dbPath,
    CCA_LOGS_ROOT: seed.logsRoot,
    CCA_RECORDINGS_ROOT: seed.recordingsRoot,
    CCA_SETTINGS_PATH: seed.settingsPath,
  };

  let current: ChildProcess | undefined;
  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.on(signal, () => (current ? current.kill(signal) : process.exit(1)));
  }

  const all = commands(port);
  for (const [i, args] of all.entries()) {
    const isServer = i === all.length - 1;
    if (isServer) console.log(`Seeded app: http://localhost:${port}`);
    const code = await runNext(args, seededEnv, (child) => (current = child));
    if (isServer || code !== 0) process.exit(code);
  }
}
