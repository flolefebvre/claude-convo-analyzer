"use server";

// Server Actions for the app. The one action is the Refresh MUTATION — reads
// (the list, the expanded row's detail) are served by the server components via
// the `_lib/conversations` seam, driven by the URL. A "use server" module's
// exports may be imported and called from a "use client" component, but the
// client never imports core itself (ADR-0002).

import { actionPipe } from "@flefebvre/next-pipe/pipes";
import { success } from "@flefebvre/next-pipe/server";

import { getPublishedRefreshRunner, startOrJoinRefresh } from "@/app/_lib/refresh-events";

/**
 * Start a Refresh, or join the one running, and return at once with
 * `"started"` or `"already running"`.
 *
 * The Refresh runs in a worker thread through the process-wide refresh runner
 * (ADR-0004) and outlives this request. Its progress and its outcome reach
 * every open page on the `refresh` Channel, whose `finished` re-renders each
 * page on fresh rows; nothing here waits for it.
 *
 * @example
 * const result = await refreshConversations();
 * if (result.status === "success") show(result.data); // "started"
 */
export const refreshConversations = actionPipe().handle(async () =>
  success(startOrJoinRefresh(getPublishedRefreshRunner())),
);
