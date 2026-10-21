// `GET /api/api-request/<id>/raw` — an API request raw: its body
// as the conversation logs rebuild it, as JSON. Fetched by the "What
// was sent" panel only when the reader first presses its Raw JSON toggle, apart from
// its sibling `GET /api/api-request/<id>`. Same row id, same
// staleness: after a re-parse, a stale page's read gets a 404.

import { routePipe } from "@flefebvre/next-pipe/pipes";
import { json } from "@flefebvre/next-pipe/server";

import { loadRawApiRequest } from "@/app/_lib/conversations";

import { apiRequestIdSchema } from "../api-request-id-schema";

/**
 * The API request with row id `[id]` raw: `requestBody`, as the logs
 * rebuild it (parameters, system prompt, tools, messages; not exactly as sent
 * — the billing block, `metadata` and `stream` are missing, and so are the
 * `missingMessageCount` messages the logs could not rebuild), and that count.
 * 400 for a malformed id, 404 for an unknown one.
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
