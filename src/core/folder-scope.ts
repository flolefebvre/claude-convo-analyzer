// The Folder scope of a read (GLOSSARY.md, **Folder**): the Conversations of
// every Project at or below a Folder's path, or — narrowed to **this folder** —
// of the Project at that exact path only. Shared by every scoped read (Trends'
// daily spend, the Tools stats and samples) so they all span the same set.

import type { PrismaClient } from "@/core/prisma/generated/client";
import { type FolderScope, isProjectInFolderScope } from "@/lib/project-path";

/**
 * The Prisma `where` fragment on a Conversation for a scope: `{}` when
 * unscoped, else its Project ids. The ids are resolved here with
 * {@link isProjectInFolderScope} rather than a SQL `LIKE`, which SQLite runs
 * case-insensitively and with `_`/`%` as wildcards — paths are matched exactly.
 */
export async function conversationInFolderScope(
  prisma: Pick<PrismaClient, "project">,
  scope: FolderScope,
): Promise<{ conversation?: { projectId: { in: number[] } } }> {
  if (!scope.folder) return {};
  const projects = await prisma.project.findMany({ select: { id: true, path: true } });
  const ids = projects.filter((p) => isProjectInFolderScope(p.path, scope)).map((p) => p.id);
  return { conversation: { projectId: { in: ids } } };
}
