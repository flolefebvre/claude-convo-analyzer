// `GET /api/recorder` — what answers on the configured Recorder port, polled by
// the app bar's Recorder item while the page is open. The item's server part
// reads it once for the first paint; this is the read after it, which no server
// component can do (`docs/codebase/app-router.md`).

import { routePipe } from "@flefebvre/next-pipe/pipes";
import { json } from "@flefebvre/next-pipe/server";
import { connection } from "next/server";

import { readConfiguredRecorderStatus } from "@/app/_lib/recorder";

/**
 * The Recorder's status: its health when it runs, else `off` or `portTaken`,
 * each with the port.
 *
 * @example const res = await callRoute(routes.api.recorder.GET());
 */
export const GET = routePipe<RouteContext<"/api/recorder">>().handle(async () => {
  // A status read at build time would be served to every poll.
  await connection();
  return json(200, await readConfiguredRecorderStatus());
});
