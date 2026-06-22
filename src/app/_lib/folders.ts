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
  /** Dash-encoded folder key (`project.folder`) — the stable Project identity
   *  and the value carried in the `?folder=` URL param. */
  folder: string;
  /** Friendly label to display: the basename of `project.path`, widened to a
   *  minimal trailing path suffix when two Projects share a basename. */
  label: string;
  /** The decoded absolute path (`project.path`), e.g. for a hover title. */
  path: string;
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
  const byFolder = new Map<string, ConversationSummary[]>();
  for (const s of summaries) {
    const list = byFolder.get(s.project.folder);
    if (list) list.push(s);
    else byFolder.set(s.project.folder, [s]);
  }

  const entries: FolderEntry[] = [...byFolder.values()].map((rows) => {
    const { project } = rows[0];
    return {
      folder: project.folder,
      label: friendlyFolderName(project.path),
      path: project.path,
      count: rows.length,
      costUsd: rows.reduce((sum, r) => sum + r.costUsd, 0),
      tokensTotal: rows.reduce((sum, r) => sum + r.tokens.total, 0),
      unpriced: rows.some((r) => r.unpriced),
      latestActivity: latestActivity(rows),
    };
  });

  disambiguateLabels(entries);

  // Newest Project on top; ties broken by friendly label asc, then by the
  // folder key asc, so the output is fully deterministic.
  return entries.sort((a, b) => {
    if (a.latestActivity !== b.latestActivity) {
      // ISO strings (and "" for unknown) sort lexically; reverse for descending.
      return a.latestActivity < b.latestActivity ? 1 : -1;
    }
    const byLabel = a.label.localeCompare(b.label);
    if (byLabel !== 0) return byLabel;
    return a.folder.localeCompare(b.folder);
  });
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
 * and the table's two-line Folder cell so both stay consistent.
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
 * entries with a unique basename keep their bare basename. If the full paths
 * still collide (identical paths — shouldn't happen since `folder` is the key,
 * but guarded), the folder key is appended so labels stay unique + deterministic.
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

    for (const e of group) {
      const widened = trailingSuffix(e.path, depth);
      // Identical paths can't be split by any suffix; the folder key, which is
      // the unique Project identity, is the deterministic last-resort tiebreak.
      e.label =
        group.filter((g) => trailingSuffix(g.path, depth) === widened).length > 1
          ? `${widened} (${e.folder})`
          : widened;
    }
  }
}
