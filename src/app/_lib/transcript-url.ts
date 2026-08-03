// URL view-state for the transcript route (`/conversation/<sessionId>`): which
// agent's transcript the pane shows, carried in `?agent=<id>`. Mirrors the list
// table's `sort.ts` conventions — defensive `string | string[]` parsing like
// `resolveExpanded`, and `URLSearchParams`-based href construction — but for the
// transcript view's own route rather than the list's query-only links.
//
// React-free + I/O-free so it unit-tests in the node vitest environment.

/** First value of a `searchParams` entry (Next gives `string | string[]`). */
function firstParam(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/**
 * Resolve the selected agent id from the raw `?agent=` search param. Mirrors
 * `resolveExpanded`: first value when the param repeats, and an absent/empty
 * value yields `undefined` — the core `getTranscript` then defaults to the main
 * (root) agent, so the caller never needs to know the root's id.
 */
export function resolveAgent(
  raw: string | string[] | undefined,
): string | undefined {
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
 * Resolve the anchored tool call from the raw `?call=` search param — the
 * `tool_use` id a Tools-page drill-down link points at. The transcript renders
 * that call EXPANDED and highlighted; the matching `#call-<id>` fragment does
 * the scrolling. A fragment alone could not do the expanding: it never reaches
 * the server.
 */
export function resolveCall(
  raw: string | string[] | undefined,
): string | undefined {
  return firstParam(raw) || undefined;
}

/** The element id of one tool call in a transcript — the deep link's anchor. */
export function callAnchorId(toolUseId: string): string {
  return `call-${toolUseId}`;
}

/**
 * Deep-link to ONE tool call inside a transcript:
 * `/conversation/<id>?agent=<agent>&call=<toolUse>#call-<toolUse>`. Without a
 * `toolUseId` (an unlogged block id) it degrades to the plain agent link.
 */
export function toolCallHref(
  sessionId: string,
  agentId: string | undefined,
  toolUseId: string | null,
): string {
  const base = agentHref(sessionId, agentId);
  if (toolUseId === null) return base;
  const separator = base.includes("?") ? "&" : "?";
  const query = new URLSearchParams({ call: toolUseId }).toString();
  return `${base}${separator}${query}#${callAnchorId(toolUseId)}`;
}
