// `GET /api/api-request/<id>` — what a recorded Turn's API request sent, fetched
// by the transcript's "What was sent" leaf the first time the reader opens it.
// The page ships only the `api_request` row id; this is the read no server
// component can do, because the reader has not asked for it yet
// (`docs/codebase/app-router.md`). The row id is stable until the next re-parse
// of that Conversation — after one, or once the Recording no longer holds the
// API request, a stale page's open gets a 404.

import { routePipe } from "@flefebvre/next-pipe/pipes";
import { json } from "@flefebvre/next-pipe/server";

import { loadWhatWasSent } from "@/app/_lib/conversations";

import { apiRequestIdSchema } from "./api-request-id-schema";

/**
 * What the API request with row id `[id]` sent (parameters, timings, where
 * its new messages start, the system-prompt and tools diffs, the full
 * request): 400 for a
 * malformed id, 404 for an unknown one or one its Recording no longer holds.
 *
 * @example const res = await callRoute(routes.api["api-request"](String(message.apiRequestId)).GET());
 */
export const GET = routePipe<RouteContext<"/api/api-request/[id]">>().handle(async ({ ctx }) => {
  const id = apiRequestIdSchema.safeParse((await ctx.params).id);
  if (!id.success) return json(400, { error: "invalid api-request id" });

  const whatWasSent = await loadWhatWasSent(id.data);
  if (whatWasSent === null) return json(404, { error: "unknown api request" });
  return json(200, whatWasSent);
});
