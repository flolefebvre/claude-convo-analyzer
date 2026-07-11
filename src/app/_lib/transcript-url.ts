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
