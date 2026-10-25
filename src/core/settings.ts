// The settings file: the user's choices that outlive the server process, kept
// in `~/.claude-convo-analyzer/` rather than in the database, which a Refresh
// may rebuild. Only the user's own action writes it.

import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { z } from "zod";

/** Whether a kind of content shows in a Transcript; a missing or unreadable choice shows it. */
const shownKind = z.boolean().catch(true);

/** The Transcript filter (GLOSSARY.md): which kinds of content a Transcript shows, each on or off. */
const transcriptFilterSchema = z.object({
  toolCalls: shownKind,
  thinking: shownKind,
  whatWasSent: shownKind,
  interAgentMessages: shownKind,
  taskNotifications: shownKind,
});

/** The reader's Transcript filter (GLOSSARY.md): true for each kind of content a Transcript shows. */
export type TranscriptFilter = z.infer<typeof transcriptFilterSchema>;

/**
 * The Transcript filter that shows every kind of content: a fresh install's.
 *
 * @example await updateSettings({ transcriptFilter: TRANSCRIPT_FILTER_EVERYTHING });
 */
export const TRANSCRIPT_FILTER_EVERYTHING: TranscriptFilter = {
  toolCalls: true,
  thinking: true,
  whatWasSent: true,
  interAgentMessages: true,
  taskNotifications: true,
};

/** What the settings file holds; each setting falls back to its default on its own. */
const settingsSchema = z.object({
  /** Whether the user switched Live on. */
  live: z.boolean().catch(false),
  /** The favorited Folders' absolute paths, in the user's order: favorited order, until one is moved. */
  favorites: z.array(z.string()).catch([]),
  /** Which kinds of content every Transcript shows. */
  transcriptFilter: transcriptFilterSchema.catch(TRANSCRIPT_FILTER_EVERYTHING),
});

/** The user's saved choices. */
export type Settings = z.infer<typeof settingsSchema>;

/** What a fresh install starts with: Live off, no favorites, every kind of Transcript content shown. */
const DEFAULT_SETTINGS: Settings = { live: false, favorites: [], transcriptFilter: TRANSCRIPT_FILTER_EVERYTHING };

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
 * await writeSettings({ live: true, favorites: [], transcriptFilter: TRANSCRIPT_FILTER_EVERYTHING });
 */
export function writeSettings(settings: Settings, settingsPath = defaultSettingsPath()): Promise<void> {
  return inWriteOrder(() => saveSettings(settings, settingsPath));
}

/** A change to the settings: the settings it replaces, or a function of the current ones returning them. */
export type SettingsChange = Partial<Settings> | ((current: Settings) => Partial<Settings>);

/**
 * Apply `change` to the settings saved at `settingsPath` and save the result,
 * keeping every setting it does not name. The process's writes run one after
 * another, so a change always reads what the one before it saved.
 *
 * @example
 * await updateSettings({ live: true });
 * await updateSettings(({ favorites }) => ({ favorites: [...favorites, "/home/me/dev/api"] }));
 */
export function updateSettings(change: SettingsChange, settingsPath = defaultSettingsPath()): Promise<void> {
  return inWriteOrder(async () => {
    const current = await readSettings(settingsPath);
    const replaced = typeof change === "function" ? change(current) : change;
    await saveSettings({ ...current, ...replaced }, settingsPath);
  });
}

/** The process's last settings write, settled either way: the next one starts after it. */
let lastWrite: Promise<unknown> = Promise.resolve();

/** Run `write` after every write queued before it; its own failure reaches only its caller. */
function inWriteOrder(write: () => Promise<void>): Promise<void> {
  const thisWrite = lastWrite.then(write);
  lastWrite = thisWrite.catch(() => undefined);
  return thisWrite;
}

/** Save `settings` through a partial file renamed into place. */
async function saveSettings(settings: Settings, settingsPath: string): Promise<void> {
  await mkdir(path.dirname(settingsPath), { recursive: true });
  const partialPath = `${settingsPath}.${process.pid}.partial`;
  await writeFile(partialPath, `${JSON.stringify(settings, null, 2)}\n`);
  await rename(partialPath, settingsPath);
}
