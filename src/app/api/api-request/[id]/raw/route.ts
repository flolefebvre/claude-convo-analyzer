// `GET /api/api-request/<id>/raw` — a recorded API request raw: its body as
// sent, its response body and its request headers, as JSON. Fetched by the
// "What was sent" panel only when the reader first opens its Raw view, apart
// from its sibling `GET /api/api-request/<id>`: bodies run to hundreds of KB.
// Same row id, same staleness: after a re-parse, or once the Recording no
// longer holds the API request, a stale page's read gets a 404.

import { routePipe } from "@flefebvre/next-pipe/pipes";
import { json } from "@flefebvre/next-pipe/server";

import { loadRawApiRequest } from "@/app/_lib/conversations";

import { apiRequestIdSchema } from "../api-request-id-schema";

/**
 * The API request with row id `[id]` raw (`requestBody`, `responseBody`,
 * `requestHeaders`): 400 for a malformed id, 404 for an unknown one or one its
 * Recording no longer holds.
 *
 * @example const res = await callRoute(routes.api["api-request"](String(apiRequestId)).raw.GET());
 */
export const GET = routePipe<RouteContext<"/api/api-request/[id]/raw">>().handle(async ({ ctx }) => {
  const id = apiRequestIdSchema.safeParse((await ctx.params).id);
  if (!id.success) return json(400, { error: "invalid api-request id" });

  const rawApiRequest = await loadRawApiRequest(id.data);
  if (rawApiRequest === null) return json(404, { error: "unknown api request" });
  return json(200, rawApiRequest);
});
