// The Folder scope of a read (GLOSSARY.md, **Folder**): the Conversations of
// every Project at or below a Folder's path, or — narrowed to **this folder** —
// of the Project at that exact path only. Shared by every scoped read (Trends'
// daily spend, the Tools stats and samples) so they all span the same set.

import type { PrismaClient } from "@/core/prisma/generated/client";

/** The scope axes a read accepts — the `?folder=` and `?thisFolder=` values. */
export type FolderScopeOptions = {
  /** Scope to the Folder at this absolute path and everything below it; all Projects when omitted. */
  folder?: string;
  /** Narrow {@link folder} to its own Project's Conversations (**this folder**). */
  thisFolderOnly?: boolean;
};

/**
 * True when a Project at `projectPath` lies in the scope: the path equals the
 * Folder's, or — unless narrowed to this folder — starts with it plus `/`.
 *
 * @example isProjectInFolderScope("/a/b/c", { folder: "/a/b" }) // true
 */
export function isProjectInFolderScope(projectPath: string, scope: FolderScopeOptions): boolean {
  if (scope.folder === undefined) return true;
  if (projectPath === scope.folder) return true;
  return !scope.thisFolderOnly && projectPath.startsWith(`${scope.folder}/`);
}

/**
 * The Prisma `where` fragment on a Conversation for a scope: `{}` when
 * unscoped, else its Project ids. The ids are resolved here with
 * {@link isProjectInFolderScope} rather than a SQL `LIKE`, which SQLite runs
 * case-insensitively and with `_`/`%` as wildcards — paths are matched exactly.
 */
export async function conversationInFolderScope(
  prisma: Pick<PrismaClient, "project">,
  scope: FolderScopeOptions,
): Promise<{ conversation?: { projectId: { in: number[] } } }> {
  if (scope.folder === undefined) return {};
  const projects = await prisma.project.findMany({ select: { id: true, path: true } });
  const ids = projects.filter((p) => isProjectInFolderScope(p.path, scope)).map((p) => p.id);
  return { conversation: { projectId: { in: ids } } };
}
