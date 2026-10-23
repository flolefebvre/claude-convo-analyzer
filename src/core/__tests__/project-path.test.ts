// A Conversation's Project is identified by its path (GLOSSARY.md, Project):
// the directory its records' `cwd` states, moved only by a switch into a git
// worktree of that directory — never by ordinary `cd` drift, and never by the
// lossy name of the log folder the Conversation is filed in while a sibling in
// that folder states its `cwd`. Across Refreshes: `incremental.test.ts`.

import path from "node:path";
import { describe, expect, it } from "vitest";
import { friendlyName } from "@/lib/project-path";
import { listConversations } from "@/core/read";

import { seededTempDb } from "./helpers/temp-db";

const PROJECT_LOGS_ROOT = path.join(import.meta.dirname, "fixtures", "project-logs");
const WINDOWS_PROJECT_LOGS_ROOT = path.join(import.meta.dirname, "fixtures", "windows-project-logs");

/** The Project path of every Conversation, by session id. */
async function projectPathBySessionId(dbPath: string): Promise<Record<string, string>> {
  const conversations = await listConversations({ dbPath });
  return Object.fromEntries(conversations.map((c) => [c.id, c.project.path]));
}

describe("Project path", () => {
  const db = seededTempDb({ prefix: "cca-project-path-", logsRoot: PROJECT_LOGS_ROOT });

  it("moves a Conversation that switches into a worktree to the worktree root, whatever its log folder decodes to", async () => {
    const byId = await projectPathBySessionId(db.dbPath);

    expect(byId["sess-into-worktree"]).toBe("/Users/me/dev/repo/.claude/worktrees/feature");
  });

  it("keeps a Conversation in its first cwd through cd drift into subdirectories, elsewhere and other repos' worktrees", async () => {
    const byId = await projectPathBySessionId(db.dbPath);

    expect(byId["sess-drift"]).toBe("/Users/me/dev/repo");
  });

  it("puts a Conversation that visits several worktrees in the last one it visited", async () => {
    const byId = await projectPathBySessionId(db.dbPath);

    expect(byId["sess-two-worktrees"]).toBe("/Users/me/dev/repo/.claude/worktrees/second");
  });

  it("puts a cwd-less Conversation in the Project of a sibling in its log folder, not the folder name's decode", async () => {
    const byId = await projectPathBySessionId(db.dbPath);

    // `-Users-me-dev-acme-api` decodes to /Users/me/dev/acme/api.
    expect(byId["sess-acme-cwdless"]).toBe("/Users/me/dev/acme-api");
  });

  it("borrows the Project with the most Conversations in the log folder", async () => {
    const byId = await projectPathBySessionId(db.dbPath);

    expect(byId["sess-most-cwdless"]).toBe("/Users/me/dev/most/b");
  });

  it("breaks a tie between candidate Projects by the smallest path", async () => {
    const byId = await projectPathBySessionId(db.dbPath);

    expect(byId["sess-tied-cwdless"]).toBe("/Users/me/dev/tied/a");
  });

  it("decodes the log folder name only when no Conversation filed there states a cwd", async () => {
    const byId = await projectPathBySessionId(db.dbPath);

    expect(byId["sess-lone-cwdless"]).toBe("/Users/me/dev/lone/wolf");
  });
});

// Logs written by Claude Code on native Windows: `cwd` is a Windows path, and
// the log folder is that path with the drive colon and each `\` turned into `-`.
// Read the same on every OS the suite runs on.
describe("Project path from Windows logs", () => {
  const db = seededTempDb({ prefix: "cca-windows-project-path-", logsRoot: WINDOWS_PROJECT_LOGS_ROOT });

  it("keeps a Windows Project path exactly as its cwd states it, through cd drift", async () => {
    const byId = await projectPathBySessionId(db.dbPath);

    expect(byId["sess-win-repo"]).toBe("C:\\Users\\me\\repo");
    expect(friendlyName(byId["sess-win-repo"])).toBe("repo");
  });

  it("keeps Projects nested under a drive at their own paths", async () => {
    const byId = await projectPathBySessionId(db.dbPath);

    expect([byId["sess-win-api"], byId["sess-win-web"]]).toEqual(["D:\\work\\tools\\api", "D:\\work\\tools\\web"]);
  });

  it("keeps Projects whose friendly names collide apart by their paths", async () => {
    const byId = await projectPathBySessionId(db.dbPath);

    expect([byId["sess-win-a-app"], byId["sess-win-b-app"]]).toEqual([
      "C:\\Users\\me\\a\\app",
      "C:\\Users\\me\\b\\app",
    ]);
  });

  it("moves a Conversation that switches into a worktree to the worktree root", async () => {
    const byId = await projectPathBySessionId(db.dbPath);

    expect(byId["sess-win-into-worktree"]).toBe("C:\\Users\\me\\repo\\.claude\\worktrees\\feature");
  });

  it("decodes a Windows log folder name back to a Windows path when no Conversation filed there states a cwd", async () => {
    const byId = await projectPathBySessionId(db.dbPath);

    expect(byId["sess-win-solo-cwdless"]).toBe("C:\\Users\\me\\solo");
  });
});
