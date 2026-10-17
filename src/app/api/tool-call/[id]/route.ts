// `GET /api/tool-call/<id>` — one Tool call's body, fetched by the transcript's
// tool-call leaf the first time the reader opens a collapsed call. The page
// ships only the call's summary; this is the read no server component can do,
// because the reader has not asked for the body yet (`docs/codebase/app-router.md`).
// `<id>` is the `tool_call` row id the page rendered, stable until the next
// re-parse of that Conversation — after one, a stale page's open gets a 404.

import { routePipe } from "@flefebvre/next-pipe/pipes";
import { json } from "@flefebvre/next-pipe/server";
import z from "zod";

import { loadToolCallBody } from "@/app/_lib/conversations";

/** A `tool_call` row id, as the `[id]` segment spells it. */
const idSchema = z.coerce.number().int().positive();

/**
 * The body (input, stored result, truncation and error flags) of the Tool call
 * with row id `[id]`: 400 for a malformed id, 404 for an unknown one.
 *
 * @example const res = await callRoute(routes.api["tool-call"](String(call.id)).GET());
 */
export const GET = routePipe<RouteContext<"/api/tool-call/[id]">>().handle(async ({ ctx }) => {
  const id = idSchema.safeParse((await ctx.params).id);
  if (!id.success) return json(400, { error: "invalid tool-call id" });

  const body = await loadToolCallBody(id.data);
  if (body === null) return json(404, { error: "unknown tool call" });
  return json(200, body);
});
