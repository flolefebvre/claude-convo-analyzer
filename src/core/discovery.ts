// Log discovery (ADR-0002, finding #1). Walks a Claude Code logs root and yields
// only TOP-LEVEL session files: `<logsRoot>/<project>/<sessionId>.jsonl`.
//
// Sub-agent transcripts live three levels deep at
// `<project>/<sessionId>/subagents/agent-<agentId>.jsonl` and MUST be skipped
// here (finding #1) — a later slice ingests them. We identify them by the
// `/subagents/` path segment and by their nesting depth (they are not direct
// children of a log folder), so a naive recursive walk does not conflate
// them with sessions.

import { readdirSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * The logs root `refresh()` scans when given none: `CCA_LOGS_ROOT` (empty counts
 * as unset) resolved against the process cwd, else `~/.claude/projects`. Read at
 * call time, so the env is honoured whenever it was set before the call.
 *
 * @example
 * // CCA_LOGS_ROOT=seed/logs → "<cwd>/seed/logs"
 * const sessions = discoverSessions(defaultLogsRoot());
 */
export function defaultLogsRoot(): string {
  return path.resolve(
    /*turbopackIgnore: true*/ process.env.CCA_LOGS_ROOT || path.join(os.homedir(), ".claude", "projects"),
  );
}

/** A discovered top-level session file plus its on-disk change keys. */
export type DiscoveredSession = {
  /** Name of the log folder the session is filed in (its directory, dash-encoded). */
  logFolderName: string;
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
 * Discover every top-level session file under `logsRoot`. Each log folder is
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
    const logFolderName = projectEntry.name;
    const projectDir = path.join(logsRoot, logFolderName);

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
        logFolderName,
        sessionId,
        sourcePath,
        sourceMtime: Math.floor(stat.mtimeMs),
        sourceSize: stat.size,
      });
    }
  }
  return sessions;
}

/** A discovered sub-agent transcript plus the parent linkage from its PATH. */
export type DiscoveredSubAgent = {
  /** The spawned agent id (file stem `agent-<agentId>.jsonl`). */
  agentId: string;
  /** Absolute path to the sub-agent `.jsonl` file. */
  sourcePath: string;
};

/**
 * Discover every sub-agent transcript for one session: the files at
 * `<projectDir>/<sessionId>/subagents/agent-<agentId>.jsonl` (finding #1). The
 * parent sessionId/agentId live in the PATH; the caller already holds the
 * session, so we return only the agentId + path. Missing dirs → empty list.
 */
export function discoverSubAgents(projectDir: string, sessionId: string): DiscoveredSubAgent[] {
  const subagentsDir = path.join(projectDir, sessionId, "subagents");
  let entries;
  try {
    entries = readdirSync(subagentsDir, { withFileTypes: true });
  } catch {
    return []; // no subagents/ dir → no sub-agents (not fatal)
  }

  const out: DiscoveredSubAgent[] = [];
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const name = entry.name;
    if (!name.startsWith("agent-") || !name.endsWith(".jsonl")) continue;
    const agentId = name.slice("agent-".length, -".jsonl".length);
    out.push({ agentId, sourcePath: path.join(subagentsDir, name) });
  }
  return out;
}

/**
 * Decode a dash-encoded log folder name back to an absolute path
 * (`/` ⇐ `-`). Lossy/ambiguous on a real `-` (finding #10) — used only as a
 * last resort when neither a Conversation nor any sibling in its log folder
 * states a `cwd` (see `resolveProjectPath` in refresh.ts).
 *
 * @example decodeLogFolderName("-Users-me-dev-acme-api") // "/Users/me/dev/acme/api"
 */
export function decodeLogFolderName(logFolderName: string): string {
  return logFolderName.replace(/-/g, "/");
}
