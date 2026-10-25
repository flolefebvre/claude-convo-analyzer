// Log discovery (ADR-0002, finding #1). Walks a Claude Code logs root and yields
// only TOP-LEVEL session files: `<logsRoot>/<project>/<sessionId>.jsonl`.
//
// Sub-agent transcripts live three levels deep at
// `<project>/<sessionId>/subagents/agent-<agentId>.jsonl` and MUST be skipped
// here (finding #1) — a later slice ingests them. We identify them by the
// `/subagents/` path segment and by their nesting depth (they are not direct
// children of a log folder), so a naive recursive walk does not conflate
// them with sessions.

import { readdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { realpathUnlessVanished, statUnlessVanished } from "@/core/vanished-file";

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
      const stat = statUnlessVanished(sourcePath);
      if (stat === null) continue;
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
  /** Absolute path the transcript is read at: a link's own path, not its target's. */
  sourcePath: string;
  /** Absolute path to its `agent-<agentId>.meta.json` beside it; null when there is none. */
  metaPath: string | null;
  /** The file's mtime in epoch ms, floored; a link's target's. */
  sourceMtime: number;
  /** The file's size in bytes; a link's target's. */
  sourceSize: number;
};

/** One session's discovered sub-agent transcripts, and the links among its entries that were not followed. */
export type DiscoveredSubAgents = {
  subAgents: DiscoveredSubAgent[];
  /** Links that dangle, or resolve outside the logs root (see {@link discoverSubAgents}). */
  unfollowedLinkCount: number;
};

/** Whether `realPath` lies inside the directory `rootRealPath`, both with every link resolved. */
function isInsideRoot(realPath: string, rootRealPath: string): boolean {
  const rootWithSep = rootRealPath.endsWith(path.sep) ? rootRealPath : rootRealPath + path.sep;
  return realPath.startsWith(rootWithSep);
}

/**
 * Discover every sub-agent transcript for one session: the entries at
 * `<projectDir>/<sessionId>/subagents/agent-<agentId>.jsonl` (finding #1), each
 * with its change key and the meta file beside it, if any, found in the same
 * directory listing. The parent sessionId/agentId live in the PATH; the caller
 * already holds the session, so we return only the agentId + paths. Missing
 * dirs → empty list.
 *
 * An entry that is not a regular file by its listing — a symlink a resumed
 * session holds to its parent's transcript, a junction on Windows — is
 * followed (log-format §10): kept when it resolves to a regular file inside
 * `logsRootRealPath` (the logs root, every link resolved), its change key the
 * target's. One that dangles or resolves outside the root is counted in
 * `unfollowedLinkCount`; one that resolves to anything else is skipped.
 *
 * @example
 * const { subAgents } = discoverSubAgents(projectDir, "sess-1", realpathSync(logsRoot));
 */
export function discoverSubAgents(
  projectDir: string,
  sessionId: string,
  logsRootRealPath: string,
): DiscoveredSubAgents {
  const subagentsDir = path.join(projectDir, sessionId, "subagents");
  let entries;
  try {
    entries = readdirSync(subagentsDir, { withFileTypes: true });
  } catch {
    return { subAgents: [], unfollowedLinkCount: 0 }; // no subagents/ dir → no sub-agents (not fatal)
  }

  const metaFileNames = new Set(
    entries.filter((entry) => entry.isFile() && entry.name.endsWith(".meta.json")).map((entry) => entry.name),
  );
  const subAgents: DiscoveredSubAgent[] = [];
  let unfollowedLinkCount = 0;
  for (const entry of entries) {
    const name = entry.name;
    if (!name.startsWith("agent-") || !name.endsWith(".jsonl")) continue;
    const sourcePath = path.join(subagentsDir, name);
    const stat = statUnlessVanished(sourcePath);
    if (!entry.isFile()) {
      const realPath = stat === null ? null : realpathUnlessVanished(sourcePath);
      if (realPath === null || !isInsideRoot(realPath, logsRootRealPath)) {
        unfollowedLinkCount += 1;
        continue;
      }
    }
    // A regular file gone between its listing and its stat is absent at discovery.
    if (stat === null || !stat.isFile()) continue;
    const agentId = name.slice("agent-".length, -".jsonl".length);
    const metaFileName = `agent-${agentId}.meta.json`;
    subAgents.push({
      agentId,
      sourcePath,
      metaPath: metaFileNames.has(metaFileName) ? path.join(subagentsDir, metaFileName) : null,
      sourceMtime: Math.floor(stat.mtimeMs),
      sourceSize: stat.size,
    });
  }
  return { subAgents, unfollowedLinkCount };
}

/** The log folder name of a Windows path: its drive letter, then `--` for `:\`. */
const WINDOWS_LOG_FOLDER_NAME = /^([A-Za-z])--/;

/**
 * Decode a dash-encoded log folder name back to an absolute path: a name
 * starting with a drive letter and `--` to a Windows path (`C:\` ⇐ `C--`,
 * `\` ⇐ `-`), any other to a POSIX path (`/` ⇐ `-`). Lossy/ambiguous on a real
 * `-` (finding #10) — used only as a last resort when neither a Conversation
 * nor any sibling in its log folder states a `cwd` (see `resolveProjectPath` in
 * refresh.ts). UNC paths (`\\server\share`) are not decoded as Windows paths.
 *
 * @example decodeLogFolderName("-Users-me-dev-acme-api") // "/Users/me/dev/acme/api"
 * @example decodeLogFolderName("C--Users-me-repo") // "C:\\Users\\me\\repo"
 */
export function decodeLogFolderName(logFolderName: string): string {
  const drive = WINDOWS_LOG_FOLDER_NAME.exec(logFolderName)?.[1];
  if (drive === undefined) return logFolderName.replace(/-/g, "/");
  return `${drive}:\\${logFolderName.slice(drive.length + 2).replace(/-/g, "\\")}`;
}
