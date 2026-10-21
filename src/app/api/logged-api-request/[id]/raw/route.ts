// `GET /api/logged-api-request/<id>/raw` — a logged API request raw: its body
// as the conversation logs rebuild it so far, as JSON. Fetched by the "What
// was sent" panel only when the reader first opens its Raw view, apart from
// its sibling `GET /api/logged-api-request/<id>`. Same row id, same
// staleness: after a re-parse, a stale page's read gets a 404.

import { routePipe } from "@flefebvre/next-pipe/pipes";
import { json } from "@flefebvre/next-pipe/server";

import { loadLoggedRawApiRequest } from "@/app/_lib/conversations";

import { loggedApiRequestIdSchema } from "../logged-api-request-id-schema";

/**
 * The logged API request with row id `[id]` raw: `requestBody`, as the logs
 * rebuild it so far (parameters, system prompt, tools; not exactly as sent —
 * the billing block and `metadata` are missing too), and a null
 * `responseBody` and `requestHeaders`, which the logs do not keep. 400 for a
 * malformed id, 404 for an unknown one.
 *
 * @example const res = await callRoute(routes.api["logged-api-request"](String(loggedApiRequestId)).raw.GET());
 */
export const GET = routePipe<RouteContext<"/api/logged-api-request/[id]/raw">>().handle(async ({ ctx }) => {
  const id = loggedApiRequestIdSchema.safeParse((await ctx.params).id);
  if (!id.success) return json(400, { error: "invalid logged-api-request id" });

  const rawApiRequest = await loadLoggedRawApiRequest(id.data);
  if (rawApiRequest === null) return json(404, { error: "unknown logged api request" });
  return json(200, rawApiRequest);
});
