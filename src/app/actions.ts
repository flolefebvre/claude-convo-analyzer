"use server";

// Server Actions for the app: the Refresh and the Live switch, its mutations —
// reads (the list, the expanded row's detail) are served by the server components via
// the `_lib/conversations` seam, driven by the URL. A "use server" module's
// exports may be imported and called from a "use client" component, but the
// client never imports core itself (ADR-0002).

import { actionPipe } from "@flefebvre/next-pipe/pipes";
import { error, success } from "@flefebvre/next-pipe/server";
import { z } from "zod";

import { getLive, switchLive } from "@/app/_lib/live";
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

/** What `setLive` reads: whether to turn Live on or off. */
const liveSwitchSchema = z.object({ on: z.boolean() });

/**
 * Turn Live on or off, as the user chose, and save the choice. Returns whether
 * Live is on now; when the switch failed, the error carries that too.
 *
 * @example
 * const result = await setLive({ on: true });
 * if (result.status === "success") show(result.data.isLiveOn); // true
 */
export const setLive = actionPipe(liveSwitchSchema).handle(async ({ input }) => {
  try {
    await switchLive(input.on);
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    return error("liveNotSwitched", { message, isLiveOn: getLive().isOn() });
  }
  return success({ isLiveOn: getLive().isOn() });
});
