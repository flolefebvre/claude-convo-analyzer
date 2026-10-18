import { describe, expect, it } from "vitest";

import { deriveFolders } from "@/app/_lib/folders";
import {
  deriveFolderTree,
  findFolderNode,
  folderScopeLabel,
  type FolderNode,
  initiallyOpenFolderPaths,
  openPathsDownToScope,
} from "@/app/_lib/folder-tree";

import { summary } from "./helpers/summaries";

const HOME = "/home/me";

/** The tree of Projects, one Conversation per path unless stated otherwise. */
function treeOf(paths: string[]): FolderNode[] {
  return deriveFolderTree(deriveFolders(paths.map((path, i) => summary({ id: `s${i}`, path }))), HOME);
}

/** Each row as `label` with its children nested, for shape assertions. */
type Shape = { label: string; children?: Shape[] };
function shape(nodes: FolderNode[]): Shape[] {
  return nodes.map((n) =>
    n.children.length === 0 ? { label: n.label } : { label: n.label, children: shape(n.children) },
  );
}

/** The node at `path`, failing the test when the tree has none. */
function nodeAt(roots: FolderNode[], path: string): FolderNode {
  const node = findFolderNode(roots, path);
  if (!node) throw new Error(`no Folder at ${path}`);
  return node;
}

describe("deriveFolderTree", () => {
  it("roots the home directory as `~` and every other tree at its top-level directory", () => {
    const roots = treeOf([`${HOME}/dev/api`, `${HOME}/ai/bot`, "/tmp/scratch/1", "/opt/tool"]);

    expect(roots.map((r) => [r.label, r.path]).sort()).toEqual([
      ["/opt", "/opt"],
      ["/tmp", "/tmp"],
      ["~", HOME],
    ]);
  });

  it("never compacts a root into its only child", () => {
    expect(shape(treeOf([`${HOME}/dev/api`]))).toEqual([{ label: "~", children: [{ label: "dev/api" }] }]);
    expect(shape(treeOf(["/tmp/scratch/1", "/tmp/scratch/2"]))).toEqual([
      { label: "/tmp", children: [{ label: "scratch", children: [{ label: "1" }, { label: "2" }] }] },
    ]);
  });

  it("compacts a chain of single-child directories into one row", () => {
    const roots = treeOf([`${HOME}/dev/mylibs/a`, `${HOME}/dev/mylibs/b`, `${HOME}/ai/bot`]);

    const mylibs = nodeAt(roots, `${HOME}/dev/mylibs`);
    expect(mylibs.label).toBe("dev/mylibs");
    expect(mylibs.children.map((c) => c.label).sort()).toEqual(["a", "b"]);
    expect(findFolderNode(roots, `${HOME}/dev`)).toBeUndefined();
  });

  it("nests a repo's worktrees under it, through a compacted `.claude/worktrees` row", () => {
    const repo = `${HOME}/dev/api`;
    const roots = treeOf([repo, `${repo}/.claude/worktrees/one`, `${repo}/.claude/worktrees/two`]);

    const worktrees = nodeAt(roots, repo).children;
    expect(worktrees.map((w) => [w.label, w.path])).toEqual([[".claude/worktrees", `${repo}/.claude/worktrees`]]);
    expect(worktrees[0].children.map((w) => w.label).sort()).toEqual(["one", "two"]);
  });

  it("stops a compacted chain at a Project, which keeps its own row", () => {
    const roots = treeOf([`${HOME}/dev/api`, `${HOME}/dev/api/packages/core`]);

    expect(shape(roots)).toEqual([
      { label: "~", children: [{ label: "dev/api", children: [{ label: "packages/core" }] }] },
    ]);
  });

  it("sums every Folder's count, cost and unpriced flag over the Projects at or below it", () => {
    const repo = `${HOME}/dev/api`;
    const roots = deriveFolderTree(
      deriveFolders([
        summary({ id: "a", path: repo, costUsd: 1 }),
        summary({ id: "b", path: repo, costUsd: 2 }),
        summary({ id: "c", path: `${repo}/.claude/worktrees/one`, costUsd: 4, unpriced: true }),
        summary({ id: "d", path: `${HOME}/ai/bot`, costUsd: 8 }),
      ]),
      HOME,
    );

    const home = nodeAt(roots, HOME);
    expect([home.count, home.costUsd, home.unpriced]).toEqual([4, 15, true]);
    const api = nodeAt(roots, repo);
    expect([api.count, api.costUsd, api.unpriced]).toEqual([3, 7, true]);
    expect(nodeAt(roots, `${HOME}/ai/bot`).unpriced).toBe(false);
  });

  it("gives a Project with sub-Folders its own Conversations as this folder", () => {
    const repo = `${HOME}/dev/api`;
    const roots = deriveFolderTree(
      deriveFolders([
        summary({ id: "a", path: repo, costUsd: 1, unpriced: true }),
        summary({ id: "b", path: `${repo}/.claude/worktrees/one`, costUsd: 4 }),
      ]),
      HOME,
    );

    expect(nodeAt(roots, repo).thisFolder).toEqual({ count: 1, costUsd: 1, unpriced: true });
  });

  it("gives no this-folder row to a leaf Project, nor to a Folder with no Conversations of its own", () => {
    const roots = treeOf([`${HOME}/dev/a`, `${HOME}/dev/b`]);

    expect(nodeAt(roots, `${HOME}/dev/a`).thisFolder).toBeNull();
    expect(nodeAt(roots, `${HOME}/dev`).thisFolder).toBeNull();
  });

  it("orders siblings by their subtree's latest activity, newest first, ties by label then path", () => {
    const roots = deriveFolderTree(
      deriveFolders([
        summary({ id: "a", path: `${HOME}/old/x`, endedAt: "2026-01-01T00:00:00.000Z" }),
        // `old` holds the newest activity of all, below its first child.
        summary({ id: "b", path: `${HOME}/old/y`, endedAt: "2026-05-01T00:00:00.000Z" }),
        summary({ id: "c", path: `${HOME}/mid`, endedAt: "2026-03-01T00:00:00.000Z" }),
        summary({ id: "d", path: `${HOME}/b-tie`, endedAt: "2026-02-01T00:00:00.000Z" }),
        summary({ id: "e", path: `${HOME}/a-tie`, endedAt: "2026-02-01T00:00:00.000Z" }),
      ]),
      HOME,
    );

    const home = nodeAt(roots, HOME);
    expect(home.children.map((c) => c.label)).toEqual(["old", "mid", "a-tie", "b-tie"]);
    expect(home.latestActivity).toBe("2026-05-01T00:00:00.000Z");
    expect(nodeAt(roots, `${HOME}/old`).children.map((c) => c.label)).toEqual(["y", "x"]);
  });

  it("roots a Project at the home directory itself as `~`, with this folder when it has sub-Folders", () => {
    const roots = treeOf([HOME, `${HOME}/dev/api`]);

    expect(roots.map((r) => r.label)).toEqual(["~"]);
    expect(roots[0].thisFolder).toEqual({ count: 1, costUsd: 0, unpriced: false });
  });

  it("roots another user's directory beside `~`, never at an ancestor of it, with disjoint totals", () => {
    const roots = deriveFolderTree(
      deriveFolders([
        summary({ id: "a", path: `${HOME}/dev/api`, costUsd: 100 }),
        summary({ id: "b", path: `${HOME}/dev/web`, costUsd: 50 }),
        summary({ id: "c", path: "/home/other/proj", costUsd: 1 }),
      ]),
      HOME,
    );

    expect(roots.map((r) => [r.label, r.path, r.count, r.costUsd]).sort()).toEqual([
      ["/home/other", "/home/other", 1, 1],
      ["~", HOME, 2, 150],
    ]);
    // `/home/meow` shares the `me` prefix with no `/` boundary: still not home.
    expect(treeOf(["/home/meow/x"]).map((r) => r.path)).toEqual(["/home/meow"]);
  });
});

describe("findFolderNode", () => {
  it("finds a Folder under `~` when another root sorts first", () => {
    // Timestamps tie, so `/home/other` sorts before `~` by label.
    const roots = treeOf([`${HOME}/dev/api`, "/home/other/x"]);
    expect(roots[0].label).toBe("/home/other");

    expect(findFolderNode(roots, `${HOME}/dev/api`)?.label).toBe("dev/api");
    expect(findFolderNode(roots, "/home/other/x")?.label).toBe("x");
  });

  it("finds a Folder under `~` past a Project rooted at an ancestor of home", () => {
    const roots = treeOf([`${HOME}/dev/api`, "/home"]);
    expect(roots.map((r) => r.label)).toEqual(["/home", "~"]);

    expect(findFolderNode(roots, `${HOME}/dev/api`)?.label).toBe("dev/api");
  });
});

describe("initiallyOpenFolderPaths", () => {
  const repo = `${HOME}/dev/api`;
  const roots = treeOf([
    repo,
    `${repo}/.claude/worktrees/one`,
    `${repo}/.claude/worktrees/two`,
    `${HOME}/ai/bot`,
    "/tmp/scratch/1",
    "/tmp/scratch/2",
  ]);

  it("opens only the roots, one level, when nothing is selected", () => {
    expect([...initiallyOpenFolderPaths(roots, {})].sort()).toEqual(["/tmp", HOME].sort());
  });

  it("also opens the path down to the selected Folder, but not the Folder itself", () => {
    const open = initiallyOpenFolderPaths(roots, { folder: `${repo}/.claude/worktrees/one` });
    expect([...open].sort()).toEqual(["/tmp", HOME, repo, `${repo}/.claude/worktrees`].sort());
  });

  it("opens the selected Folder too when narrowed to this folder, whose row is its child", () => {
    expect(initiallyOpenFolderPaths(roots, { folder: repo, thisFolderOnly: true }).has(repo)).toBe(true);
    expect(initiallyOpenFolderPaths(roots, { folder: repo }).has(repo)).toBe(false);
  });

  describe("openPathsDownToScope", () => {
    // The user closed `~` and opened `/tmp/scratch`.
    const userOpened = new Set(["/tmp", "/tmp/scratch"]);

    it("adds the path down to a new scope to the open Folders, leaving the user's as they were", () => {
      const open = openPathsDownToScope(userOpened, roots, { folder: `${repo}/.claude/worktrees/one` });
      expect([...open].sort()).toEqual([...userOpened, HOME, repo, `${repo}/.claude/worktrees`].sort());
    });

    it("opens nothing for All folders, and closes nothing", () => {
      expect([...openPathsDownToScope(userOpened, roots, {})]).toEqual([...userOpened]);
    });
  });
});

describe("folderScopeLabel", () => {
  it("names the Folder, and says so when narrowed to this folder", () => {
    const node = nodeAt(treeOf([`${HOME}/dev/api`, `${HOME}/dev/api/x`]), `${HOME}/dev/api`);
    expect(folderScopeLabel(node, { folder: node.path })).toBe("dev/api");
    expect(folderScopeLabel(node, { folder: node.path, thisFolderOnly: true })).toBe("dev/api (this folder)");
  });
});
