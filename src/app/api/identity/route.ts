// `GET /api/identity` — which app serves this port, and its version. The
// launcher's loopback probe reads it when its port is taken: this app means a
// second launch, which opens the running one; anything else means another
// program holds the port. Known at build time, so the response is prerendered.

import { routePipe } from "@flefebvre/next-pipe/pipes";
import { json } from "@flefebvre/next-pipe/server";

import { APP_PACKAGE_NAME, APP_VERSION } from "@/lib/app-identity";

/**
 * The app's npm package name and version, as `{ name, version }`.
 *
 * @example const res = await callRoute(routes.api.identity.GET());
 */
export const GET = routePipe<RouteContext<"/api/identity">>().handle(async () =>
  json(200, { name: APP_PACKAGE_NAME, version: APP_VERSION }),
);
