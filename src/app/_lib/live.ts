// The app's Live: core's Live (framework-free, ADR-0002) composed over the
// published refresh runner, so every Refresh it begins reaches the `refresh`
// Channel, and the settings file that keeps the user's choice. The file holds
// the choice; `getLive().isOn()` is what runs now. Only the user's switch writes
// the file: when Live fails to come back at boot, the choice stays, and the next
// boot tries again.

import { getPublishedRefreshRunner } from "@/app/_lib/refresh-events";
import { createLive, type Live, watchLogsAndRecordings } from "@/core/live";
import { readSettings, updateSettings } from "@/core/settings";

/** How long Live gathers changes before it runs a Refresh. */
const LIVE_DEBOUNCE_MS = 2000;

const liveSlot = Symbol.for("claude-convo-analyzer.live");

const globalForLive = globalThis as unknown as { [liveSlot]?: Live };

/**
 * The process-wide Live, over the published refresh runner. Created on first
 * call and kept on `globalThis`, so a dev re-evaluation of this module does not
 * watch twice.
 *
 * @example const isLiveOn = getLive().isOn();
 */
export function getLive(): Live {
  globalForLive[liveSlot] ??= createLive({
    runner: getPublishedRefreshRunner(),
    watch: watchLogsAndRecordings(),
    debounceMs: LIVE_DEBOUNCE_MS,
  });
  return globalForLive[liveSlot];
}

/**
 * The user's switch: turn Live on or off, then save the choice. Throws when
 * Live cannot start watching, or the choice cannot be saved; a switch on whose
 * choice is not saved turns Live back off.
 *
 * @example await switchLive(true);
 */
export async function switchLive(on: boolean): Promise<void> {
  const live = getLive();
  if (!on) {
    live.turnOff();
    await updateSettings({ live: false });
    return;
  }
  live.turnOn();
  try {
    await updateSettings({ live: true });
  } catch (error) {
    live.turnOff();
    throw error;
  }
}

/**
 * At boot, turn Live back on when the user left it on. A failure is logged and
 * leaves Live off; it never stops the server.
 *
 * @example await restoreLive(); // from `register()` in instrumentation.ts
 */
export async function restoreLive(): Promise<void> {
  const { live: isLiveChosen } = await readSettings();
  if (!isLiveChosen) return;
  try {
    getLive().turnOn();
  } catch (error) {
    console.error("Live was left on, but could not start watching", error);
  }
}
