"use server";

// Server Actions for the conversation list. The one action left is the Refresh
// MUTATION — reads (the list, the expanded row's detail) are served by the
// server components via the `_lib/conversations` seam, driven by the URL.
// Importing core is side-effect-free — it opens no DB at load (see
// `import-side-effects.test.ts`) — so core is a normal top-level import. The
// action still calls `connection()` before touching the DB, so the synchronous
// better-sqlite3 work runs only on a real request and never during build-time
// prerender (Cache Components is on). A "use server" module's exports may be
// imported and called from a "use client" component, but the client never
// imports core itself (ADR-0002).

import { revalidatePath } from "next/cache";
import { connection } from "next/server";

import { type RefreshSummary, refresh } from "@/core/refresh";

/**
 * Re-scan the local Claude Code logs into the DB and refresh the list.
 *
 * Runs the core `refresh()` (skip-unchanged / re-parse-changed / delete-gone),
 * revalidates `/` so the server component re-reads the now-fresh rows on the next
 * render, and returns the plain serializable {@link RefreshSummary} so the client
 * button can surface what happened.
 */
export async function refreshConversations(): Promise<RefreshSummary> {
  // Exclude the DB write/read from prerendering: with Cache Components on, this
  // would otherwise run at build time. connection() guarantees we only get here
  // on a real request (Next 16 docs).
  await connection();
  const summary = await refresh();
  // The list page is a server component reading core at request time; revalidate
  // so the next render reflects the freshly-scanned rows.
  revalidatePath("/");
  return summary;
}
