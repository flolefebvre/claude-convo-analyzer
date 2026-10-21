// `GET /api/disk-usage` — the size on disk of the database and the Claude Code
// logs, read by the app bar's Disk usage item each time it opens. Never on
// first paint: a multi-GB logs root takes a while to walk.

import { routePipe } from "@flefebvre/next-pipe/pipes";
import { json } from "@flefebvre/next-pipe/server";
import { connection } from "next/server";

import { measureDiskUsage } from "@/app/_lib/disk-usage";

/**
 * The two sizes, each `{ path, bytes }`, keyed `database` and `logs`.
 *
 * @example const res = await callRoute(routes.api["disk-usage"].GET());
 */
export const GET = routePipe<RouteContext<"/api/disk-usage">>().handle(async () => {
  // A measurement at build time would be served to every open.
  await connection();
  return json(200, await measureDiskUsage());
});
