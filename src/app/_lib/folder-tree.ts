// The folder tree the sidebar navigates by (GLOSSARY.md, **Folder**): every
// directory that is a Project's path or contains one, built purely from the
// Project paths — no worktree-specific rule — by rolling up the per-Project
// `FolderEntry` aggregates of `deriveFolders` (one place sums cost and count).
//
// The roots are the home directory, labelled `~`, and the top-level directory
// of every other path (`/tmp`, `/opt`); a root always keeps its own row. Below
// the roots, a directory that is not a Project and holds a single sub-Folder is
// compacted into it (`dev/mylibs`, `.claude/worktrees`).
//
// React-free + I/O-free: the home directory is a parameter, resolved at the
// server edge, and the client sidebar renders the serialized result.

import { type FolderScope, isProjectInFolderScope } from "@/app/_lib/folder-scope";
import { type FolderEntry, newestFirst } from "@/app/_lib/folders";

/** The Conversation count and summed cost of a set of Projects. */
export type FolderTotals = {
  count: number;
  /** Summed cost (USD); a lower bound when {@link unpriced} is true. */
  costUsd: number;
  /** True when any Conversation in the set has unpriced usage. */
  unpriced: boolean;
};

/** One row of the folder tree, with the totals of every Project at or below it. */
export type FolderNode = FolderTotals & {
  /** The Folder's absolute path — the `?folder=` value. */
  path: string;
  /** `~`, a root's absolute path (`/tmp`), or the path below the parent row (`.claude/worktrees`). */
  label: string;
  /** Latest activity over the subtree, as an ISO string; `""` if none is known. */
  latestActivity: string;
  /** The Folder's own Conversations, when it is a Project that also has sub-Folders; else null. */
  thisFolder: FolderTotals | null;
  /** The sub-Folders, newest first. */
  children: FolderNode[];
};

/** A directory while the tree is built: its Project, if any, and its subdirectories by name. */
type Directory = {
  path: string;
  project: FolderEntry | undefined;
  subdirectoryByName: Map<string, Directory>;
};

/**
 * Build the folder tree from the per-Project entries, newest-first at every
 * level.
 *
 * @example deriveFolderTree(deriveFolders(rows), os.homedir())
 */
export function deriveFolderTree(entries: FolderEntry[], home: string): FolderNode[] {
  const rootByPath = new Map<string, { directory: Directory; label: string }>();
  for (const entry of entries) {
    const { rootPath, label, below } = rootOf(entry.path, home);
    let root = rootByPath.get(rootPath);
    if (!root) {
      root = { directory: emptyDirectory(rootPath), label };
      rootByPath.set(rootPath, root);
    }
    let directory = root.directory;
    for (const name of below) {
      let sub = directory.subdirectoryByName.get(name);
      if (!sub) {
        sub = emptyDirectory(`${directory.path === "/" ? "" : directory.path}/${name}`);
        directory.subdirectoryByName.set(name, sub);
      }
      directory = sub;
    }
    directory.project = entry;
  }
  return [...rootByPath.values()].map((root) => folderNode(root.directory, root.label)).sort(newestFirst);
}

/** A directory with no Project and no subdirectories yet. */
function emptyDirectory(path: string): Directory {
  return { path, project: undefined, subdirectoryByName: new Map() };
}

/**
 * The root a Project path falls under: the home directory, or the path's
 * top-level directory (`/` itself for the path `/`), plus the segments below it.
 */
function rootOf(projectPath: string, home: string): { rootPath: string; label: string; below: string[] } {
  if (isProjectInFolderScope(projectPath, { folder: home })) {
    return { rootPath: home, label: "~", below: segments(projectPath.slice(home.length)) };
  }
  const [top, ...below] = segments(projectPath);
  if (top === undefined) return { rootPath: "/", label: "/", below: [] };
  return { rootPath: `/${top}`, label: `/${top}`, below };
}

/** Non-empty `/`-separated segments of a path. */
function segments(path: string): string[] {
  return path.split("/").filter((s) => s.length > 0);
}

/**
 * The row of `directory`, labelled `label`: compacted with its only
 * subdirectory while it is neither a root nor a Project, its totals summed over
 * its subtree.
 */
function folderNode(start: Directory, startLabel: string, isRoot = true): FolderNode {
  let directory = start;
  let label = startLabel;
  while (!isRoot && directory.project === undefined && directory.subdirectoryByName.size === 1) {
    const [[name, only]] = directory.subdirectoryByName;
    label = `${label}/${name}`;
    directory = only;
  }

  const children = [...directory.subdirectoryByName]
    .map(([name, sub]) => folderNode(sub, name, false))
    .sort(newestFirst);
  const own = directory.project;
  const parts: { count: number; costUsd: number; unpriced: boolean; latestActivity: string }[] = own
    ? [own, ...children]
    : children;
  return {
    path: directory.path,
    label,
    count: parts.reduce((sum, p) => sum + p.count, 0),
    costUsd: parts.reduce((sum, p) => sum + p.costUsd, 0),
    unpriced: parts.some((p) => p.unpriced),
    latestActivity: parts.reduce((latest, p) => (p.latestActivity > latest ? p.latestActivity : latest), ""),
    thisFolder: own && children.length > 0 ? { count: own.count, costUsd: own.costUsd, unpriced: own.unpriced } : null,
    children,
  };
}

/**
 * The Folder at exactly `path`, or undefined when no row has that path (an
 * unknown path, or one inside a compacted chain).
 *
 * @example findFolderNode(folderTree, scope.folder)
 */
export function findFolderNode(roots: FolderNode[], path: string): FolderNode | undefined {
  for (const node of roots) {
    if (node.path === path) return node;
    if (isProjectInFolderScope(path, { folder: node.path })) return findFolderNode(node.children, path);
  }
  return undefined;
}

/**
 * The Folders that start open: every root (one level), and the path down to
 * the selected Folder — the Folder itself too when narrowed to this folder,
 * since its this-folder row is its child.
 *
 * @example const [openPaths, setOpenPaths] = useState(() => initiallyOpenFolderPaths(roots, scope))
 */
export function initiallyOpenFolderPaths(roots: FolderNode[], scope: FolderScope): Set<string> {
  const open = new Set(roots.map((root) => root.path));
  const selected = scope.folder;
  if (!selected) return open;
  const walk = (nodes: FolderNode[]) => {
    for (const node of nodes) {
      const isAncestor = node.path !== selected && isProjectInFolderScope(selected, { folder: node.path });
      if (isAncestor || (node.path === selected && scope.thisFolderOnly)) open.add(node.path);
      if (isAncestor) walk(node.children);
    }
  };
  walk(roots);
  return open;
}

/**
 * The selected scope's name, for the breadcrumb, the overview band and the
 * phone picker's summary.
 *
 * @example folderScopeLabel(selectedFolder, scope) // "acme-api (this folder)"
 */
export function folderScopeLabel(node: FolderNode, scope: FolderScope): string {
  return scope.thisFolderOnly ? `${node.label} (this folder)` : node.label;
}
