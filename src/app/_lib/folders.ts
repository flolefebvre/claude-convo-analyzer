// Pure app-zone seam: derive the left sidebar's folder list and scope the
// conversation table to one Project, built ON TOP of the core's
// `ConversationSummary[]` (no new core API — respects the core/UI boundary in
// ADR-0002). The only core touch is a type-only import, erased at compile time.
//
// React-free + I/O-free so it unit-tests in the node vitest environment; the
// page/sidebar are thin shells over these.

import type { ConversationSummary } from "@/core/read";

/** One left-sidebar row: a distinct Project, summarized for display + linking. */
export type FolderEntry = {
  /** The Project's absolute path (`project.path`) — its identity, the value
   *  carried in the `?folder=` URL param, and the hover title. */
  path: string;
  /** Friendly label to display: the basename of `path`, widened to a minimal
   *  trailing path suffix when two Projects share a basename. */
  label: string;
  /** Number of conversations in this Project. */
  count: number;
  /** Summed cost (USD) across the Project's conversations. A lower bound when
   *  {@link unpriced} is true. */
  costUsd: number;
  /** Summed total token count across the Project's conversations. */
  tokensTotal: number;
  /** True when ANY conversation in the Project has unpriced model usage, so the
   *  UI can mark the Project's cost as a lower bound. */
  unpriced: boolean;
  /** Latest activity across the Project's conversations, as an ISO string
   *  (max of `endedAt`, falling back to `startedAt`). `""` if none is known. */
  latestActivity: string;
};

export function deriveFolders(summaries: ConversationSummary[]): FolderEntry[] {
  const summariesByProjectPath = new Map<string, ConversationSummary[]>();
  for (const s of summaries) {
    const list = summariesByProjectPath.get(s.project.path);
    if (list) list.push(s);
    else summariesByProjectPath.set(s.project.path, [s]);
  }

  const entries: FolderEntry[] = [...summariesByProjectPath].map(([projectPath, rows]) => ({
    path: projectPath,
    label: friendlyFolderName(projectPath),
    count: rows.length,
    costUsd: rows.reduce((sum, r) => sum + r.costUsd, 0),
    tokensTotal: rows.reduce((sum, r) => sum + r.tokens.total, 0),
    unpriced: rows.some((r) => r.unpriced),
    latestActivity: latestActivity(rows),
  }));

  disambiguateLabels(entries);

  return entries.sort(newestFirst);
}

/**
 * The sidebar's order: newest activity on top; ties broken by label asc, then
 * by path asc, so the order is fully deterministic.
 *
 * @example entries.sort(newestFirst)
 */
export function newestFirst(
  a: { latestActivity: string; label: string; path: string },
  b: { latestActivity: string; label: string; path: string },
): number {
  if (a.latestActivity !== b.latestActivity) {
    // ISO strings (and "" for unknown) sort lexically; reverse for descending.
    return a.latestActivity < b.latestActivity ? 1 : -1;
  }
  const byLabel = a.label.localeCompare(b.label);
  if (byLabel !== 0) return byLabel;
  return a.path.localeCompare(b.path);
}

/**
 * The most recent activity across a Project's conversations, as an ISO string.
 * Each row contributes its `endedAt`, falling back to `startedAt` when
 * `endedAt` is empty; `""` (the core's "unknown" sentinel) is ignored.
 * ISO8601 strings sort lexically in chronological order, so a plain string max
 * is the latest moment. Returns `""` when no row has any timestamp.
 */
function latestActivity(rows: ConversationSummary[]): string {
  let latest = "";
  for (const r of rows) {
    const when = r.endedAt !== "" ? r.endedAt : r.startedAt;
    if (when > latest) latest = when;
  }
  return latest;
}

/**
 * The friendly name for a Project path: its last non-empty `/`-separated
 * segment (basename), or "" if the path has none. Used for the sidebar labels
 * and the table's Folder cell under All folders so both stay consistent.
 */
export function friendlyFolderName(path: string): string {
  return pathSegments(path).at(-1) ?? "";
}

/** Non-empty `/`-separated segments of a path, e.g. "/a/b/" -> ["a", "b"]. */
function pathSegments(path: string): string[] {
  return path.split("/").filter((s) => s.length > 0);
}

/** A path's last `depth` segments joined with "/" (clamped to what exists). */
function trailingSuffix(path: string, depth: number): string {
  return pathSegments(path).slice(-depth).join("/");
}

/**
 * Widen the `label` of any entries whose bare basename collides with another
 * entry's, in place. Each colliding GROUP is widened to the minimal trailing
 * path suffix (fewest segments) that makes every member of that group unique —
 * entries with a unique basename keep their bare basename. Entries are keyed
 * by path, so the full path always tells two of them apart.
 */
function disambiguateLabels(entries: FolderEntry[]): void {
  const byBasename = new Map<string, FolderEntry[]>();
  for (const e of entries) {
    const group = byBasename.get(e.label);
    if (group) group.push(e);
    else byBasename.set(e.label, [e]);
  }

  for (const group of byBasename.values()) {
    if (group.length < 2) continue; // unique basename -> keep it bare

    const maxDepth = Math.max(...group.map((e) => pathSegments(e.path).length));
    let depth = 2;
    for (; depth <= maxDepth; depth++) {
      const suffixes = group.map((e) => trailingSuffix(e.path, depth));
      if (new Set(suffixes).size === group.length) break;
    }

    for (const e of group) e.label = trailingSuffix(e.path, depth);
  }
}
