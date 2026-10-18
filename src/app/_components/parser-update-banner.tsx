// The parser-update banner: one slim line under the app bar, on every route,
// while stored Conversations were produced by an older parser than the current
// one (or left unstamped by an interrupted Refresh) — until someone clicks
// Refresh, the app shows their old-parser data. It embeds its own Refresh
// control; when that Refresh revalidates the layout, the count is 0 and the
// banner is gone. It never starts a Refresh itself and cannot be dismissed.
//
// Hidden while a Refresh runs: rows written mid-run stay unstamped until the
// run's final stamp, so they would count.

import { Info } from "lucide-react";

import { RefreshButton } from "@/app/_components/refresh-button";
import { loadOutdatedParserVersionCount } from "@/app/_lib/conversations";
import { formatOutdatedParserNotice } from "@/app/_lib/refresh-summary";
import { getRefreshRunner } from "@/core/refresh-runner";

/**
 * The notice that Conversations need a Refresh after a parser update, or
 * nothing. Reads the DB, so the root layout renders it in its own `<Suspense>`.
 *
 * @example <Suspense fallback={null}><ParserUpdateBanner /></Suspense>
 */
export async function ParserUpdateBanner() {
  const outdatedCount = await loadOutdatedParserVersionCount();
  // Read at render time, after the loader's `connection()`: the runner is
  // created lazily, and its state changes between requests.
  if (outdatedCount === 0 || getRefreshRunner().state().status === "running") return null;

  return (
    <div role="status" className="border-b bg-muted/60">
      <div className="mx-auto flex w-full max-w-7xl items-center gap-3 px-4 py-1.5 sm:px-6">
        <Info className="size-4 shrink-0 text-muted-foreground" aria-hidden />
        <p className="flex-1 text-ui">{formatOutdatedParserNotice(outdatedCount)}</p>
        <RefreshButton variant="outline" size="sm" />
      </div>
    </div>
  );
}
