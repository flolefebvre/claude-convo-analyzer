// URL view-state for the transcript route (`/conversation/<sessionId>`): which
// agent's transcript the pane shows, carried in `?agent=<id>`. Mirrors the list
// table's `sort.ts` conventions — defensive `string | string[]` parsing like
// `resolveExpanded`, and `URLSearchParams`-based href construction — but for the
// transcript view's own route rather than the list's query-only links.
//
// React-free + I/O-free so it unit-tests in the node vitest environment.

import { FIRST_PAGE, firstParam } from "@/app/_lib/search-params";

/**
 * Resolve the selected agent id from the raw `?agent=` search param. Mirrors
 * `resolveExpanded`: first value when the param repeats, and an absent/empty
 * value yields `undefined` — the core `getTranscript` then defaults to the main
 * (root) agent, so the caller never needs to know the root's id.
 */
export function resolveAgent(raw: string | string[] | undefined): string | undefined {
  return firstParam(raw) || undefined;
}

/**
 * Build a link to one agent's transcript: `/conversation/<sessionId>?agent=<id>`.
 * Omitting `agentId` (or passing an empty one) links to the bare route, i.e. the
 * main/root agent — used for the breadcrumb's root crumb. Path and query values
 * are encoded so ids with reserved characters stay valid.
 */
export function agentHref(sessionId: string, agentId?: string): string {
  const base = `/conversation/${encodeURIComponent(sessionId)}`;
  if (!agentId) return base;
  return `${base}?${new URLSearchParams({ agent: agentId }).toString()}`;
}

/**
 * Resolve the selected Side request from the raw `?sideRequest=` search param:
 * its `api_request` row id, or `undefined` when absent or not a positive integer.
 *
 * @example resolveSideRequest("42") // 42
 */
export function resolveSideRequest(raw: string | string[] | undefined): number | undefined {
  const value = firstParam(raw);
  if (value === undefined || !/^[1-9]\d{0,9}$/.test(value)) return undefined;
  return Number(value);
}

/**
 * Link to one Side request of a Conversation: `/conversation/<sessionId>?sideRequest=<id>`,
 * the pane then showing what it sent.
 *
 * @example sideRequestHref(view.sessionId, sideRequest.apiRequestId) // "/conversation/<id>?sideRequest=42"
 */
export function sideRequestHref(sessionId: string, apiRequestId: number): string {
  return `${agentHref(sessionId)}?${new URLSearchParams({ sideRequest: String(apiRequestId) }).toString()}`;
}

/**
 * Link to one Transcript page of an agent: its {@link agentHref} with `?page=`
 * set — never for page 1, the bare link — and the `?from=` list view carried
 * on. It names no `?msg=`/`?call=` anchor: paging leaves the deep-link target.
 *
 * @example transcriptPageHref(view.sessionId, "a7", 2, listReturn) // "/conversation/<id>?agent=a7&page=2"
 */
export function transcriptPageHref(
  sessionId: string,
  agentId: string | undefined,
  page: number,
  listReturn: string | undefined,
): string {
  const base = agentHref(sessionId, agentId);
  if (page <= FIRST_PAGE) return withListReturn(base, listReturn);
  const separator = base.includes("?") ? "&" : "?";
  return withListReturn(`${base}${separator}${new URLSearchParams({ page: String(page) }).toString()}`, listReturn);
}

/**
 * Resolve the anchored tool call from the raw `?call=` search param — the
 * `tool_use` id a Tools-page drill-down link points at. The transcript renders
 * that call EXPANDED and highlighted, and the pane's `ScrollToAnchor` scrolls
 * to it. A fragment alone could not do the expanding — it never reaches the
 * server — nor reliably the scrolling: the call streams in after the fragment
 * was tried. The `#call-<id>` fragment stays for copied links and no-JS.
 */
export function resolveCall(raw: string | string[] | undefined): string | undefined {
  return firstParam(raw) || undefined;
}

/** The element id of one tool call in a transcript — the deep link's anchor. */
export function callAnchorId(toolUseId: string): string {
  return `call-${toolUseId}`;
}

/**
 * Resolve the anchored message from the raw `?msg=` search param — the message
 * `uuid` a search result points at. Same idiom as {@link resolveCall}: the query
 * param highlights the message server-side, the pane's `ScrollToAnchor` scrolls
 * to it, and the `#msg-<uuid>` fragment stays for copied links and no-JS.
 *
 * The anchor is the log record's `uuid`, NOT the database row id: row ids are
 * re-assigned on every re-parse, so an id-based link would silently rot (worse,
 * point at an unrelated message). An unknown uuid simply highlights nothing.
 */
export function resolveMessage(raw: string | string[] | undefined): string | undefined {
  return firstParam(raw) || undefined;
}

/** The element id of one message in a transcript — the deep link's anchor. */
export function messageAnchorId(messageUuid: string): string {
  return `msg-${messageUuid}`;
}

/**
 * Deep-link to ONE message inside a transcript:
 * `/conversation/<id>?agent=<agent>&msg=<uuid>#msg-<uuid>` — how a search result
 * opens the conversation AND the agent it matched in, scrolled to the hit.
 * Without a `messageUuid` (a record the log left unidentified) it degrades to
 * the plain agent link.
 */
export function messageHref(sessionId: string, agentId: string | undefined, messageUuid: string | null): string {
  const base = agentHref(sessionId, agentId);
  if (messageUuid === null) return base;
  const separator = base.includes("?") ? "&" : "?";
  const query = new URLSearchParams({ msg: messageUuid }).toString();
  return `${base}${separator}${query}#${encodeURIComponent(messageAnchorId(messageUuid))}`;
}

/**
 * Deep-link to ONE tool call inside a transcript:
 * `/conversation/<id>?agent=<agent>&call=<toolUse>#call-<toolUse>`. Without a
 * `toolUseId` (an unlogged block id) it degrades to the plain agent link.
 */
export function toolCallHref(sessionId: string, agentId: string | undefined, toolUseId: string | null): string {
  const base = agentHref(sessionId, agentId);
  if (toolUseId === null) return base;
  const separator = base.includes("?") ? "&" : "?";
  const query = new URLSearchParams({ call: toolUseId }).toString();
  return `${base}${separator}${query}#${callAnchorId(toolUseId)}`;
}

/**
 * Carry the list view a transcript was opened from (`?from=`, a
 * `listReturnQuery`) on a transcript link, so its back link can restore that
 * view. The query joins any existing one and the `#fragment` stays last; with no
 * view to carry the link is returned unchanged.
 *
 * @example withListReturn(agentHref(row.id), listReturnQuery(links)) // "/conversation/<id>?from=sortBy%3Ddate%26dir%3Ddesc"
 */
export function withListReturn(href: string, from: string | undefined): string {
  if (!from) return href;
  const hashAt = href.indexOf("#");
  const [path, hash] = hashAt === -1 ? [href, ""] : [href.slice(0, hashAt), href.slice(hashAt)];
  const separator = path.includes("?") ? "&" : "?";
  return `${path}${separator}${new URLSearchParams({ from }).toString()}${hash}`;
}

/** The conversation list's own view-state params — all a `?from=` may restore. */
const LIST_VIEW_PARAMS = ["sortBy", "dir", "folder", "thisFolder", "expanded", "range", "errors", "page"] as const;

/**
 * Resolve the raw `?from=` search param into the transcript's way back: `href`
 * is the list page (`/`) with only the list's own view-state params kept, so the
 * link can never leave the list whatever the param holds; `from` is that same
 * query, normalized, for the transcript's own links to carry on (`undefined`
 * when there is nothing to restore).
 *
 * @example resolveListReturn(params.from) // { href: "/?folder=%2Fhome%2Fdev%2Fapi&page=2", from: "folder=%2Fhome%2Fdev%2Fapi&page=2" }
 */
export function resolveListReturn(raw: string | string[] | undefined): { href: string; from: string | undefined } {
  const given = new URLSearchParams(firstParam(raw) ?? "");
  const kept = new URLSearchParams();
  for (const key of LIST_VIEW_PARAMS) {
    const value = given.get(key);
    if (value) kept.set(key, value);
  }
  const from = kept.toString();
  return from === "" ? { href: "/", from: undefined } : { href: `/?${from}`, from };
}
