"use client";

// The client half of the next-sse Registry. The Registry reaches this module as
// a type only, so none of `sse.ts` (schemas, transport, core) enters the bundle.

import { createClient } from "@flefebvre/next-sse/client";

import type { sse } from "@/app/_lib/sse";

/**
 * Client Handles (`channels.refresh()`) and the hooks that subscribe to them.
 *
 * @example useChannel(channels.refresh(), { progress: ({ done, total }) => show(done, total) }, { snapshot });
 */
export const { channels, useChannel } = createClient<typeof sse>();
