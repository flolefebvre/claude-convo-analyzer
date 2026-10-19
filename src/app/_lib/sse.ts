// The app's next-sse Registry: every Channel the server publishes on, with its
// event schemas. Server-only — client components import `sse.client.ts`, which
// takes this module as a type. The one Channel is `refresh`, fed by the bridge
// in `refresh-events.ts`.

import { initSSE } from "@flefebvre/next-sse/server";
import { createMemoryTransport } from "@flefebvre/next-sse/transport/memory";
import { z } from "zod";

import type { RefreshSummary } from "@/core/refresh";
import type { RefreshOrigin } from "@/core/refresh-runner";

/** Which Refresh an event belongs to (the runner's `RefreshRunId`). */
const refreshRunIdSchema = z.string();

const refreshProgressSchema = z.object({
  runId: refreshRunIdSchema,
  done: z.number().int().nonnegative(),
  total: z.number().int().nonnegative(),
});

/** Who began the Refresh (the runner's `RefreshOrigin`); `satisfies` fails typecheck when core grows one. */
const refreshOriginSchema = z.enum(["user", "live"]) satisfies z.ZodType<RefreshOrigin>;

const durationMsSchema = z.number().nonnegative();

/** The `RefreshSummary` as it travels; `satisfies` fails typecheck when core grows a field. */
const refreshSummarySchema = z.object({
  conversationsParsed: z.number().int().nonnegative(),
  conversationsSkipped: z.number().int().nonnegative(),
  conversationsDeleted: z.number().int().nonnegative(),
  malformedLinesSkipped: z.number().int().nonnegative(),
  duplicateSessionsSkipped: z.array(z.object({ sessionId: z.string(), keptPath: z.string(), skippedPath: z.string() })),
  vanishedLogFilesSkipped: z.number().int().nonnegative(),
  undecodableRecordingsSkipped: z.number().int().nonnegative(),
  durationMs: durationMsSchema,
  durationMsByPhase: z.object({
    discovery: durationMsSchema,
    parse: durationMsSchema,
    write: durationMsSchema,
    links: durationMsSchema,
    stamp: durationMsSchema,
  }),
}) satisfies z.ZodType<RefreshSummary>;

// The Memory Transport, named rather than left to the environment: one local
// server process serves this app, and a `REDIS_URL` in the user's shell would
// otherwise move it onto a Redis server it has no use for.
const { channel, createSSE } = initSSE({ transport: createMemoryTransport() });

/**
 * The Registry: `sse.refresh()` is the Handle publishing the Refresh's
 * `progress` (absolute `{ done, total }`, once per committed batch), then its
 * `finished { summary }` or `failed { message }`, each with the `runId` of its
 * Refresh; the outcome also carries its `origin`, the user or Live.
 *
 * @example await sse.refresh().progress({ runId, done: 50, total: 2450 });
 */
export const sse = createSSE({
  refresh: channel({
    pattern: "refresh",
    events: {
      progress: refreshProgressSchema,
      finished: z.object({ runId: refreshRunIdSchema, origin: refreshOriginSchema, summary: refreshSummarySchema }),
      failed: z.object({ runId: refreshRunIdSchema, origin: refreshOriginSchema, message: z.string() }),
    },
    // Local-only app: every page may follow the Refresh.
    authorize: () => true,
  }),
});
