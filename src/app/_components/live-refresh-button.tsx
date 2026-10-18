// The Refresh control's server part: it reads the running Refresh as of this
// request and hands it to the client button as a Snapshot, so a page opened
// mid-run shows the current count straight away. Request-time, so it renders in
// its own `<Suspense>` with the idle button as fallback.

import { connection } from "next/server";

import { RefreshButton, type RefreshButtonProps } from "@/app/_components/refresh-button";
import { snapshotRefreshActivity } from "@/app/_lib/refresh-events";

/**
 * The Refresh button, following the Refresh from where it stands now.
 *
 * @example <Suspense fallback={<IdleRefreshButton />}><LiveRefreshButton reportsOutcome /></Suspense>
 */
export async function LiveRefreshButton(props: Omit<RefreshButtonProps, "snapshot">) {
  // A Snapshot baked into the prerender would resume from a stale position.
  await connection();
  return <RefreshButton {...props} snapshot={await snapshotRefreshActivity()} />;
}
