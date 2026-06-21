"use server";

// Server Actions for the conversation list (slice 3). This module is the ONLY
// place in the app that touches `src/core`'s refresh entry point, and it does so
// via the request-time dynamic-import pattern established by the list page:
// `connection()` first (so nothing here runs during prerender / build-time page
// collection, where the core's `import.meta.dirname`-based DB path is unresolved),
// then a dynamic `import("@/core/refresh")`. A "use server" module's exports may
// be imported and called from a "use client" component, but the client never
// imports core itself (ADR-0002).

import { revalidatePath } from "next/cache";
import { connection } from "next/server";

import type { ConversationDetail, RefreshSummary } from "@/core/refresh";

/**
 * Re-scan the local Claude Code logs into the DB and refresh the list.
 *
 * Runs the core `refresh()` (skip-unchanged / re-parse-changed / delete-gone),
 * revalidates `/` so the server component re-reads the now-fresh rows on the next
 * render, and returns the plain serializable {@link RefreshSummary} so the client
 * button can surface what happened.
 */
export async function refreshConversations(): Promise<RefreshSummary> {
  // Exclude this from prerendering: the core DB module resolves its path from
  // `import.meta.dirname` at load, which is unresolved at build time. connection()
  // guarantees we only get here on a real request (Next 16 docs).
  await connection();
  // Dynamic import for the same reason — load core only at request time.
  const { refresh } = await import("@/core/refresh");
  const summary = await refresh();
  // The list page is a server component reading core at request time; revalidate
  // so the next render reflects the freshly-scanned rows.
  revalidatePath("/");
  return summary;
}

/**
 * Fetch one conversation's full detail for the expandable row (slice 4).
 *
 * The interactive row is a client component (it owns expand state) and so may
 * NOT import core (ADR-0002); it calls THIS action on first expand instead. We
 * use the same request-time pattern as {@link refreshConversations}: `connection()`
 * first (no prerender / build-time evaluation of the core's `import.meta.dirname`
 * DB path), then a dynamic `import("@/core/refresh")`. Returns the plain
 * serializable {@link ConversationDetail}, or `null` for an unknown id.
 */
export async function getConversationDetail(
  id: string,
): Promise<ConversationDetail | null> {
  await connection();
  const { getConversation } = await import("@/core/refresh");
  return getConversation(id);
}
