// The seed environment: one self-contained directory holding fake logs, fake
// Recordings of some of their Conversations, and the database the genuine
// `refresh()` builds from both. Rebuilding it is wiping
// that one directory, so a seed never leaves anything behind — and never
// touches the real database or the real logs.

import { rmSync } from "node:fs";
import path from "node:path";

import { refresh, type RefreshSummary } from "@/core/refresh";

import { type FakeLogsCounts, generateFakeLogs } from "./fake-logs";
import { writeFakeRecordings } from "./fake-recordings";

/** Where a seed environment lives and what building it produced. */
export type SeedEnvironment = {
  /** The seeded SQLite database, `<dir>/seed.db`. */
  dbPath: string;
  /** The persisted fake logs, `<dir>/projects` — a later refresh re-reads them. */
  logsRoot: string;
  /** The Recordings of some of those logs' Conversations, `<dir>/recordings`. */
  recordingsRoot: string;
  /** What the generator wrote. */
  generated: FakeLogsCounts;
  /** The ingest's own report. */
  summary: RefreshSummary;
};

/**
 * Wipe `dir`, write the fake logs (timeline ending at `now`) into
 * `<dir>/projects` and their Recordings into `<dir>/recordings`, and ingest
 * both into `<dir>/seed.db` with the real `refresh()`.
 *
 * @example
 * const { dbPath, logsRoot } = await seedEnvironment({ dir: "data/seed", now: new Date() });
 */
export async function seedEnvironment(opts: { dir: string; now: Date }): Promise<SeedEnvironment> {
  const dir = path.resolve(opts.dir);
  rmSync(dir, { recursive: true, force: true });

  const logsRoot = path.join(dir, "projects");
  const dbPath = path.join(dir, "seed.db");
  const recordingsRoot = path.join(dir, "recordings");
  const { counts: generated, conversations } = generateFakeLogs({ logsRoot, now: opts.now });
  await writeFakeRecordings({ recordingsRoot, conversations });
  const summary = await refresh({ logsRoot, dbPath, recordingsRoot });
  return { dbPath, logsRoot, recordingsRoot, generated, summary };
}
