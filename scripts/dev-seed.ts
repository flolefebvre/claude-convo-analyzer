// `pnpm dev:seed` — rebuild the seed environment in `data/seed/` (as `pnpm seed`
// does, timeline ending now), then run `next dev` against it: `CCA_DB_PATH` and
// `CCA_LOGS_ROOT` point at the seed, so Refresh re-reads only the fake logs.
//
// The port is `PORT` when set, else the first free one from 3001 — so several
// worktrees can each serve their own seeded app at once. The URL is printed as
// one `Seeded app: http://localhost:<port>` line before Next starts.

import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";

import { findFreePort } from "./dev-seed/free-port";
import { seedEnvironment } from "./seed/environment";

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

async function main(): Promise<void> {
  const requested = explicitPort();

  const seed = await seedEnvironment({ dir: path.resolve("data", "seed"), now: new Date() });
  const { conversations, subAgents, projects } = seed.generated;
  console.log(`Seeded ${conversations} conversations (${subAgents} sub-agents) across ${projects} projects.`);

  const port = requested ?? (await findFreePort(FIRST_PORT));
  console.log(`Seeded app: http://localhost:${port}`);

  const nextBin = createRequire(import.meta.url).resolve("next/dist/bin/next");
  const child = spawn(process.execPath, [nextBin, "dev", "-p", String(port)], {
    stdio: "inherit",
    env: { ...process.env, CCA_DB_PATH: seed.dbPath, CCA_LOGS_ROOT: seed.logsRoot },
  });
  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.on(signal, () => child.kill(signal));
  }
  child.on("close", (code) => process.exit(code ?? 1));
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
