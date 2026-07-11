// Request-scoped readers for the conversation list. Both the layout (for the
// scope-independent sidebar folder list) and the page (for the filtered+sorted
// table) need ALL conversations. React `cache()` dedupes the read so a single
// request runs the core's `listConversations` once even though two components
// call it. `connection()` keeps the synchronous better-sqlite3 query out of
// prerendering (Cache Components is on — see page.tsx for the rationale).
//
// ADR-0002 boundary: this is the app-zone seam over the core reads; the core
// import is a real value here (a server module, never imported from a client
// file), matching how page.tsx imported it before this seam existed.

import { cache } from "react";
import { connection } from "next/server";

import { getConversation, listConversations } from "@/core/read";

/**
 * Read every conversation summary once per request. Wrapped in React `cache()`
 * so the layout and the page share one underlying core read instead of
 * double-fetching; `connection()` defers the read out of the prerender so the
 * sync DB driver does not complete at build time.
 */
export const loadConversations = cache(async () => {
  await connection();
  return listConversations();
});

/**
 * Read one conversation's full detail (the expanded row's panel data) for the
 * `?expanded=<id>` view. Same request-time gating as {@link loadConversations};
 * returns `null` for an unknown id. `cache()` keeps a re-rendered request to a
 * single core read per id.
 */
export const loadConversationDetail = cache(async (id: string) => {
  await connection();
  return getConversation(id);
});
