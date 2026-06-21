// Log discovery (ADR-0002, finding #1). Walks a Claude Code logs root and yields
// only TOP-LEVEL session files: `<logsRoot>/<project>/<sessionId>.jsonl`.
//
// Sub-agent transcripts live three levels deep at
// `<project>/<sessionId>/subagents/agent-<agentId>.jsonl` and MUST be skipped
// here (finding #1) — a later slice ingests them. We identify them by the
// `/subagents/` path segment and by their nesting depth (they are not direct
// children of a project folder), so a naive recursive walk does not conflate
// them with sessions.

import { readdirSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";

/** Default logs root: `~/.claude/projects`. */
export const DEFAULT_LOGS_ROOT = path.join(os.homedir(), ".claude", "projects");

/** A discovered top-level session file plus its on-disk change keys. */
export type DiscoveredSession = {
  /** The on-disk project folder name (dash-encoded cwd). */
  folder: string;
  /** The session id (file stem of `<sessionId>.jsonl`). */
  sessionId: string;
  /** Absolute path to the `.jsonl` file. */
  sourcePath: string;
  /** File mtime in epoch ms (incremental-refresh change key — Slice 5). */
  sourceMtime: number;
  /** File size in bytes (incremental-refresh change key — Slice 5). */
  sourceSize: number;
};

/** True when the path contains a `/subagents/` segment (a sub-agent transcript). */
export function isSubAgentPath(p: string): boolean {
  return p.split(path.sep).includes("subagents");
}

/**
 * Discover every top-level session file under `logsRoot`. Each project folder is
 * scanned for direct-child `.jsonl` files; nested directories (`<sessionId>/`,
 * which holds `subagents/`) are not descended into, so sub-agent transcripts are
 * never returned by this slice.
 */
export function discoverSessions(logsRoot: string): DiscoveredSession[] {
  let projectEntries;
  try {
    projectEntries = readdirSync(logsRoot, { withFileTypes: true });
  } catch {
    return []; // missing logs root → nothing to ingest (not fatal)
  }

  const sessions: DiscoveredSession[] = [];
  for (const projectEntry of projectEntries) {
    if (!projectEntry.isDirectory()) continue;
    const folder = projectEntry.name;
    const projectDir = path.join(logsRoot, folder);

    let fileEntries;
    try {
      fileEntries = readdirSync(projectDir, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const fileEntry of fileEntries) {
      // Top-level session files only: a direct-child `.jsonl`. The nested
      // `<sessionId>/subagents/...` files are NOT direct children, so skipping
      // non-files here is sufficient; the explicit guard documents intent.
      if (!fileEntry.isFile()) continue;
      if (!fileEntry.name.endsWith(".jsonl")) continue;

      const sourcePath = path.join(projectDir, fileEntry.name);
      if (isSubAgentPath(sourcePath)) continue;

      const sessionId = fileEntry.name.slice(0, -".jsonl".length);
      const stat = statSync(sourcePath);
      sessions.push({
        folder,
        sessionId,
        sourcePath,
        sourceMtime: Math.floor(stat.mtimeMs),
        sourceSize: stat.size,
      });
    }
  }
  return sessions;
}

/**
 * Decode a dash-encoded project folder name back to an absolute path
 * (`/` ⇐ `-`). Lossy/ambiguous on a real `-` (finding #10) — used only as a
 * fallback when no `cwd` is present on any record.
 */
export function decodeFolderName(folder: string): string {
  return folder.replace(/-/g, "/");
}
