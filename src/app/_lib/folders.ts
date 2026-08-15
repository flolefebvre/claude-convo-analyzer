import type { ConversationSummary } from "@/core/read";

export type FolderEntry = {
  folder: string;
  label: string;
  path: string;
  count: number;
  costUsd: number;
  tokensTotal: number;
  unpriced: boolean;
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

  return entries.sort((a, b) => {
    if (a.latestActivity !== b.latestActivity) {
      return a.latestActivity < b.latestActivity ? 1 : -1;
    }
    const byLabel = a.label.localeCompare(b.label);
    if (byLabel !== 0) return byLabel;
    return a.folder.localeCompare(b.folder);
  });
}

function latestActivity(rows: ConversationSummary[]): string {
  let latest = "";
  for (const r of rows) {
    const when = r.endedAt !== "" ? r.endedAt : r.startedAt;
    if (when > latest) latest = when;
  }
  return latest;
}

export function friendlyFolderName(path: string): string {
  return pathSegments(path).at(-1) ?? "";
}

function pathSegments(path: string): string[] {
  return path.split("/").filter((s) => s.length > 0);
}

function trailingSuffix(path: string, depth: number): string {
  return pathSegments(path).slice(-depth).join("/");
}

function disambiguateLabels(entries: FolderEntry[]): void {
  const byBasename = new Map<string, FolderEntry[]>();
  for (const e of entries) {
    const group = byBasename.get(e.label);
    if (group) group.push(e);
    else byBasename.set(e.label, [e]);
  }

  for (const group of byBasename.values()) {
    if (group.length < 2) continue;

    const maxDepth = Math.max(...group.map((e) => pathSegments(e.path).length));
    let depth = 2;
    for (; depth <= maxDepth; depth++) {
      const suffixes = group.map((e) => trailingSuffix(e.path, depth));
      if (new Set(suffixes).size === group.length) break;
    }

    for (const e of group) {
      const widened = trailingSuffix(e.path, depth);
      e.label =
        group.filter((g) => trailingSuffix(g.path, depth) === widened).length > 1
          ? `${widened} (${e.folder})`
          : widened;
    }
  }
}
