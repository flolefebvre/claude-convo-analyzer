import { readdirSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";

export const DEFAULT_LOGS_ROOT = path.join(os.homedir(), ".claude", "projects");

export type DiscoveredSession = {
  folder: string;
  sessionId: string;
  sourcePath: string;
  sourceMtime: number;
  sourceSize: number;
};

export function isSubAgentPath(p: string): boolean {
  return p.split(path.sep).includes("subagents");
}

export function discoverSessions(logsRoot: string): DiscoveredSession[] {
  let projectEntries;
  try {
    projectEntries = readdirSync(logsRoot, { withFileTypes: true });
  } catch {
    return [];
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

export type DiscoveredSubAgent = {
  agentId: string;
  sourcePath: string;
};

export function discoverSubAgents(projectDir: string, sessionId: string): DiscoveredSubAgent[] {
  const subagentsDir = path.join(projectDir, sessionId, "subagents");
  let entries;
  try {
    entries = readdirSync(subagentsDir, { withFileTypes: true });
  } catch {
    return [];
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

export function decodeFolderName(folder: string): string {
  return folder.replace(/-/g, "/");
}
