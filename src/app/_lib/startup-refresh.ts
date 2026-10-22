// The Refresh the app starts on its own at startup: core's read of the stored
// data (framework-free, ADR-0002) composed over the published refresh runner,
// so its progress and outcome reach every open page like any Refresh's. A
// Refresh already running (Live's catch-up) is joined by the runner itself.

import { getPublishedRefreshRunner } from "@/app/_lib/refresh-events";
import { isStoredDataMissingOrOutdated } from "@/core/read";
import type { RefreshRunner } from "@/core/refresh-runner";

/**
 * At startup, start a Refresh on `runner` (by default the published one) when
 * no Conversation is stored in the database at `dbPath`, or one an older parser
 * produced is; resolves once that is checked, never waiting for the Refresh. A
 * failure of the check or of the Refresh is logged; it never rejects.
 *
 * @example await startRefreshIfStoredDataIsMissingOrOutdated(); // from `register()` in instrumentation.ts
 */
export async function startRefreshIfStoredDataIsMissingOrOutdated({
  runner = getPublishedRefreshRunner(),
  dbPath,
}: { runner?: RefreshRunner; dbPath?: string } = {}): Promise<void> {
  try {
    if (!(await isStoredDataMissingOrOutdated({ dbPath }))) return;
  } catch (error) {
    console.error("Could not check whether the stored data needs a Refresh at startup", error);
    return;
  }
  runner.start({ origin: "startup" }).catch((error: unknown) => {
    console.error("The Refresh started at startup failed", error);
  });
}
