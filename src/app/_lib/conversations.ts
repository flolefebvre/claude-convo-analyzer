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

import {
  getConversation,
  getDailySpend,
  getTranscript,
  listConversations,
} from "@/core/read";
import { getToolCallSamples, getToolStats } from "@/core/tool-stats";

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

/**
 * Read the Trends view's daily spend: per-day, per-model priced rows for one
 * range, optionally scoped to a Project (`?folder=`). Same request-time gating
 * as {@link loadConversations}; `days` is `undefined` for "all time". `cache()`
 * dedupes to a single core read per `(folder, days)` within a request.
 */
export const loadDailySpend = cache(async (folder?: string, days?: number) => {
  await connection();
  return getDailySpend({ folder, days });
});

/**
 * Read one conversation's transcript for the `/conversation/<sessionId>` view —
 * the agent tree plus one agent's ordered messages/tool calls. `agentId` selects
 * which agent's transcript to shape; omitting it (or an unknown id) resolves to
 * the main agent inside the core reader. Same request-time gating as
 * {@link loadConversations}; returns `null` for an unknown session. `cache()`
 * dedupes to a single core read per `(id, agentId)` within a request.
 *
 * ADR-0002: this seam is the ONLY place the app touches core for transcript data.
 */
export const loadTranscript = cache(async (id: string, agentId?: string) => {
  await connection();
  return getTranscript(id, { agentId });
});

/**
 * Read the Tools view's per-tool analytics for one folder + range scope
 * (`?folder=`/`?range=`). Same request-time gating as {@link loadConversations};
 * `days` is `undefined` for "all time". `cache()` dedupes to a single core read
 * per `(folder, days)` within a request.
 */
export const loadToolStats = cache(async (folder?: string, days?: number) => {
  await connection();
  return getToolStats({ folder, days });
});

/**
 * Read one tool's drill-down (recent errors, largest results, Skill/Agent
 * breakdown) over the SAME scope as {@link loadToolStats}. Called only when a
 * row is expanded (`?expanded=<tool>`), so the table never pays for it.
 */
export const loadToolCallSamples = cache(
  async (name: string, folder?: string, days?: number) => {
    await connection();
    return getToolCallSamples(name, { folder, days });
  },
);
