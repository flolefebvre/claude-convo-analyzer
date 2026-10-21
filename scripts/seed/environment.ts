// The seed environment: one self-contained directory holding fake logs, the
// database the genuine `refresh()` builds from them, and the seeded app's
// settings file (Live off, two favorites). Rebuilding it is wiping that one directory, so a seed never leaves
// anything behind — and never touches the real database or the real logs.

import { rmSync } from "node:fs";
import path from "node:path";

import { refresh, type RefreshSummary } from "@/core/refresh";
import { writeSettings } from "@/core/settings";

import { type FakeLogsCounts, generateFakeLogs, SEED_FAVORITE_PATHS } from "./fake-logs";

/** Where a seed environment lives and what building it produced. */
export type SeedEnvironment = {
  /** The seeded SQLite database, `<dir>/seed.db`. */
  dbPath: string;
  /** The persisted fake logs, `<dir>/projects` — a later refresh re-reads them. */
  logsRoot: string;
  /** The seeded app's settings file, `<dir>/settings.json`: Live off, and {@link SEED_FAVORITE_PATHS} favorited. */
  settingsPath: string;
  /** What the generator wrote. */
  generated: FakeLogsCounts;
  /** The ingest's own report. */
  summary: RefreshSummary;
};

/**
 * Wipe `dir`, write the fake logs (timeline ending at `now`) into
 * `<dir>/projects`, and ingest them into `<dir>/seed.db` with the real
 * `refresh()`, then write the seeded app's `<dir>/settings.json`.
 *
 * @example
 * const { dbPath, logsRoot } = await seedEnvironment({ dir: "data/seed", now: new Date() });
 */
export async function seedEnvironment(opts: { dir: string; now: Date }): Promise<SeedEnvironment> {
  const dir = path.resolve(opts.dir);
  rmSync(dir, { recursive: true, force: true });

  const logsRoot = path.join(dir, "projects");
  const dbPath = path.join(dir, "seed.db");
  const generated = generateFakeLogs({ logsRoot, now: opts.now });
  const summary = await refresh({ logsRoot, dbPath });
  const settingsPath = path.join(dir, "settings.json");
  await writeSettings({ live: false, favorites: [...SEED_FAVORITE_PATHS] }, settingsPath);
  return { dbPath, logsRoot, settingsPath, generated, summary };
}
