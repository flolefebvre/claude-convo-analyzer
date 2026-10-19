// The settings file: the user's choices that outlive the server process, kept
// next to the Recordings rather than in the database, which a Refresh may
// rebuild. Only the user's own action writes it.

import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { z } from "zod";

/** What the settings file holds; each setting falls back to its default on its own. */
const settingsSchema = z.object({
  /** Whether the user switched Live on. */
  live: z.boolean().catch(false),
});

/** The user's saved choices. */
export type Settings = z.infer<typeof settingsSchema>;

/** What a fresh install starts with: Live off. */
const DEFAULT_SETTINGS: Settings = { live: false };

/**
 * The settings file: `CCA_SETTINGS_PATH` (empty counts as unset) resolved
 * against the process cwd, else `~/.claude-convo-analyzer/settings.json`. Read
 * at call time.
 *
 * @example
 * // CCA_SETTINGS_PATH=data/seed/settings.json → "<cwd>/data/seed/settings.json"
 * const settings = await readSettings(defaultSettingsPath());
 */
export function defaultSettingsPath(): string {
  return path.resolve(
    /*turbopackIgnore: true*/ process.env.CCA_SETTINGS_PATH ||
      path.join(os.homedir(), ".claude-convo-analyzer", "settings.json"),
  );
}

/**
 * The settings saved at `settingsPath`; a missing or unreadable file reads as
 * the defaults.
 *
 * @example
 * const { live } = await readSettings(); // false on a fresh install
 */
export async function readSettings(settingsPath = defaultSettingsPath()): Promise<Settings> {
  try {
    return settingsSchema.parse(JSON.parse(await readFile(settingsPath, "utf8")));
  } catch {
    return DEFAULT_SETTINGS;
  }
}

/**
 * Save `settings` at `settingsPath`, creating its directory; a reader never
 * sees a half-written file.
 *
 * @example
 * await writeSettings({ live: true });
 */
export async function writeSettings(settings: Settings, settingsPath = defaultSettingsPath()): Promise<void> {
  await mkdir(path.dirname(settingsPath), { recursive: true });
  const partialPath = `${settingsPath}.${process.pid}.partial`;
  await writeFile(partialPath, `${JSON.stringify(settings, null, 2)}\n`);
  await rename(partialPath, settingsPath);
}
