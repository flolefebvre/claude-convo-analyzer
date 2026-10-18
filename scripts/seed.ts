// `pnpm seed [--now=<ISO>]` — build the seed environment in `data/seed/`: fake
// Claude Code logs in `data/seed/projects/`, ingested by the real `refresh()`
// into `data/seed/seed.db`, and fake Recordings of some of them in
// `data/seed/recordings/`. Each run wipes and rebuilds that directory; the
// real database (`data/analyzer.db`), logs and Recordings are never touched.
//
// The seeded timeline ends at `--now`, the current instant by default. Output
// is deterministic for a given `--now` only: pin it to reproduce a seed (for
// screenshots), since the default moves with the clock.

import path from "node:path";
import { parseArgs } from "node:util";

import { seedEnvironment } from "./seed/environment";

const USAGE = `Usage: pnpm seed [--now=<ISO>]

Rebuild the seed environment in data/seed/ (seed.db + projects/ + recordings/)
from fake logs and Recordings.

  --now=<ISO>  Instant the seeded timeline ends at (default: now). The same
               --now always produces the same data; the default does not.
  --help       Show this message.`;

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: { now: { type: "string" }, help: { type: "boolean" } },
  });
  if (values.help) {
    console.log(USAGE);
    return;
  }

  const now = values.now === undefined ? new Date() : new Date(values.now);
  if (Number.isNaN(now.getTime())) {
    throw new Error(`--now: expected an ISO instant (e.g. 2026-06-22T17:00:00Z), got "${values.now}"`);
  }

  const seed = await seedEnvironment({ dir: path.resolve("data", "seed"), now });
  const { conversations, subAgents, projects } = seed.generated;
  console.log(`Seeded up to ${now.toISOString()}.`);
  console.log(`Wrote ${conversations} conversations (${subAgents} sub-agents) across ${projects} projects.`);
  console.log(`Logs:       ${seed.logsRoot}`);
  console.log(`Recordings: ${seed.recordingsRoot}`);
  console.log(`Database:   ${seed.dbPath}`);
  console.log("Refresh summary:", seed.summary);
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
