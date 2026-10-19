"use server";

// Server Actions for the app: the Refresh, the Live switch and the Recorder's
// Start and Stop, its mutations — reads (the list, the expanded row's detail)
// are served by the server components via the `_lib` seams, driven by the URL,
// and the Recorder's status by `GET /api/recorder`. A "use server" module's
// exports may be imported and called from a "use client" component, but the
// client never imports core itself (ADR-0002).

import { actionPipe } from "@flefebvre/next-pipe/pipes";
import { error, success } from "@flefebvre/next-pipe/server";
import { z } from "zod";

import { getLive, switchLive } from "@/app/_lib/live";
import { readConfiguredRecorderStatus, requestStopOfRecorder, startConfiguredRecorder } from "@/app/_lib/recorder";
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
    return error("liveNotSwitched", { message: messageOf(cause), isLiveOn: getLive().isOn() });
  }
  return success({ isLiveOn: getLive().isOn() });
});

/**
 * Start the Recorder detached on the configured port, unless one already
 * answers there, and return once it answers: `"started"` or
 * `"alreadyRunning"`. A failure (the port taken, the Recorder exiting at once)
 * comes back as an error whose message names the port.
 *
 * @example
 * const result = await startRecorder();
 * if (result.status === "success") show(result.data.outcome); // "started"
 */
export const startRecorder = actionPipe().handle(async () => {
  let outcome;
  try {
    outcome = await startConfiguredRecorder();
  } catch (cause) {
    return error("recorderNotStarted", { message: messageOf(cause) });
  }
  if (outcome.outcome === "failed") return error("recorderNotStarted", { message: outcome.message });
  return success({ outcome: outcome.outcome, port: outcome.port });
});

/** What `stopRecorder` reads: whether to stop even though sessions sent requests recently. */
const recorderStopSchema = z.object({ force: z.boolean() });

/**
 * Ask the Recorder on the configured port to stop cleanly, and return at once
 * with `"stopping"`, or `"notRunning"` when none answers. Unless `force`, a
 * Recorder that sessions sent API requests through in the last 15 minutes is
 * left running, and the error says how many.
 *
 * @example
 * const result = await stopRecorder({ force: false });
 * if (result.status === "error" && result.error.type === "sessionsActive") confirm(result.error.data.count);
 */
export const stopRecorder = actionPipe(recorderStopSchema).handle(async ({ input }) => {
  try {
    const recorderStatus = await readConfiguredRecorderStatus();
    if (recorderStatus.status !== "running") return success("notRunning" as const);
    if (recorderStatus.recentSessions.length > 0 && !input.force) {
      return error("sessionsActive", { count: recorderStatus.recentSessions.length });
    }
    await requestStopOfRecorder(recorderStatus.port);
  } catch (cause) {
    return error("recorderNotStopped", { message: messageOf(cause) });
  }
  return success("stopping" as const);
});

function messageOf(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}
