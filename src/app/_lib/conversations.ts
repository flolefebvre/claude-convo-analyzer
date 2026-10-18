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

import { getConversationErrors } from "@/core/errors";
import { buildFamily, familySizes } from "@/core/family";
import {
  countConversationsWithOutdatedParserVersion,
  getConversation,
  getDailySpend,
  getToolCallBody,
  getTranscript,
  listConversations,
} from "@/core/read";
import { searchConversations } from "@/core/search";
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
 * Count the Conversations whose parser version is not the current one, for the
 * parser-update banner. Same request-time gating as {@link loadConversations}.
 *
 * @example const outdatedCount = await loadOutdatedParserVersionCount();
 */
export const loadOutdatedParserVersionCount = cache(async () => {
  await connection();
  return countConversationsWithOutdatedParserVersion();
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
 * Read one conversation's failed turns (the expanded row's API-error section) —
 * every agent's, oldest first. Called only when a row is expanded, so the table
 * itself never pays for it. Same request-time gating as
 * {@link loadConversations}; `[]` for an unknown id.
 */
export const loadConversationErrors = cache(async (id: string) => {
  await connection();
  return getConversationErrors(id);
});

/**
 * Family size (connected-component size) for every conversation — what the
 * list's continuation badge reads. Derived from the SAME cached
 * {@link loadConversations} rows, so the badge costs no extra query; `cache()`
 * keeps the walk to once per request.
 */
export const loadFamilySizes = cache(async () => familySizes(await loadConversations()));

/**
 * The continuation family of one conversation — its whole connected component,
 * laid out as a tree with per-member cost and the family total. Built over the
 * cached {@link loadConversations} rows (ADR-0002: the core walk never touches
 * the DB itself), so the panel and the transcript banner share one read.
 * `null` for an unknown session id.
 */
export const loadFamily = cache(async (id: string) => buildFamily(await loadConversations(), id));

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
 * the agent tree plus one Transcript page of one agent's ordered messages/tool
 * calls. `agentId` selects the agent (omitted or unknown: the main agent);
 * `page` the Transcript page, and with none, the `anchoredMessage`/`anchoredCall`
 * deep-link target picks the page holding it. Same request-time gating as
 * {@link loadConversations}; returns `null` for an unknown session.
 *
 * The arguments stay positional primitives: `cache()` keys on argument
 * identity, so an options object would be a fresh reference per call and the
 * tree and the pane would no longer share their single read per request.
 *
 * ADR-0002: this seam is the ONLY place the app touches core for transcript data.
 */
export const loadTranscript = cache(
  async (id: string, agentId?: string, page?: number, anchoredMessage?: string, anchoredCall?: string) => {
    await connection();
    return getTranscript(id, { agentId, page, anchoredMessage, anchoredCall });
  },
);

/**
 * Read one Tool call's body (input and stored result) by its row id — for the
 * `?call=` anchored call server-side, and for `GET /api/tool-call/<id>` when
 * the reader opens any other. Same request-time gating as
 * {@link loadConversations}; `null` for an unknown id (the transcript was
 * re-parsed since the page rendered).
 *
 * @example const body = await loadToolCallBody(call.id);
 */
export const loadToolCallBody = cache(async (id: number) => {
  await connection();
  return getToolCallBody(id);
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
 * Run the full-text search behind `/search?q=…` — conversations grouped, most
 * recent match first, with their relevance-picked snippets. Always global: the
 * search deliberately ignores any `?folder=` scope in effect elsewhere. Same
 * request-time gating as {@link loadConversations}; `cache()` dedupes to a
 * single core read per query within a request.
 */
export const loadSearch = cache(async (query: string) => {
  await connection();
  return searchConversations(query);
});

/**
 * Read one tool's drill-down (recent errors, largest results, Skill/Agent
 * breakdown) over the SAME scope as {@link loadToolStats}. Called only when a
 * row is expanded (`?expanded=<tool>`), so the table never pays for it.
 */
export const loadToolCallSamples = cache(async (name: string, folder?: string, days?: number) => {
  await connection();
  return getToolCallSamples(name, { folder, days });
});
