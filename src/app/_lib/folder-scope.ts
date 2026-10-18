// The Folder scope as the URL carries it (GLOSSARY.md, **Folder**): `?folder=`
// names a Folder by its absolute path and scopes every view to the Projects at
// or below it; `?thisFolder=1` narrows that to the Folder's own Project
// (**this folder**). Every href that carries the scope writes it through
// {@link writeFolderScope}, so the two params always travel together.
//
// React-free + I/O-free, so the client sidebar can use it too (it never
// imports core). The core applies the same rule to its scoped reads.

import { firstParam, type ViewSearchParams } from "@/app/_lib/search-params";

/** A Folder scope: All folders when `folder` is absent. */
export type FolderScope = {
  /** The selected Folder's absolute path (`?folder=`). */
  folder?: string;
  /** True when narrowed to the Folder's own Conversations (`?thisFolder=1`). */
  thisFolderOnly?: boolean;
};

/** The one `?thisFolder=` value that narrows the scope. */
const THIS_FOLDER_ON = "1";

/**
 * Resolve the scope from raw `searchParams`. An absent or empty `?folder=` is
 * All folders, and `?thisFolder=` means nothing without one.
 *
 * @example resolveFolderScope(await searchParams) // { folder: "/home/me/dev/api", thisFolderOnly: false }
 */
export function resolveFolderScope(
  params: Pick<ViewSearchParams, "folder" | "thisFolder">,
): FolderScope & { thisFolderOnly: boolean } {
  const folder = firstParam(params.folder) || undefined;
  return { folder, thisFolderOnly: folder !== undefined && firstParam(params.thisFolder) === THIS_FOLDER_ON };
}

/**
 * {@link resolveFolderScope} over a live `URLSearchParams`, as a client
 * component's `useSearchParams()` hands it.
 *
 * @example const scope = resolveLiveFolderScope(useSearchParams())
 */
export function resolveLiveFolderScope(
  params: Pick<URLSearchParams, "get">,
): FolderScope & { thisFolderOnly: boolean } {
  return resolveFolderScope({
    folder: params.get("folder") ?? undefined,
    thisFolder: params.get("thisFolder") ?? undefined,
  });
}

/**
 * True when a Project at `projectPath` lies in the scope: its path is the
 * Folder's, or — unless narrowed to this folder — below it (`/a/b` holds
 * `/a/b/c` but not `/a/bc`).
 *
 * @example isProjectInFolderScope(row.project.path, scope)
 */
export function isProjectInFolderScope(projectPath: string, scope: FolderScope): boolean {
  if (!scope.folder) return true;
  if (projectPath === scope.folder) return true;
  return !scope.thisFolderOnly && projectPath.startsWith(`${scope.folder}/`);
}

/** True when two scopes name the same Folder, narrowed (or not) the same way. */
export function isSameFolderScope(a: FolderScope, b: FolderScope): boolean {
  return (a.folder || undefined) === (b.folder || undefined) && Boolean(a.thisFolderOnly) === Boolean(b.thisFolderOnly);
}

/**
 * Write the scope into `params` in place: both params set, or both cleared for
 * All folders.
 *
 * @example writeFolderScope(params, { folder: ctx.folder, thisFolderOnly: ctx.thisFolderOnly })
 */
export function writeFolderScope(params: URLSearchParams, scope: FolderScope): void {
  if (scope.folder) params.set("folder", scope.folder);
  else params.delete("folder");
  if (scope.folder && scope.thisFolderOnly) params.set("thisFolder", THIS_FOLDER_ON);
  else params.delete("thisFolder");
}

/**
 * The href of a sidebar Folder link: the live query re-scoped, so the current
 * surface keeps its own state (the list's sort, Trends' range, the Tools
 * table's sort) and re-scopes in place. `?expanded=` and `?page=` are dropped:
 * a row opened, or a page reached, under the old scope means nothing under the
 * new one.
 *
 * @example folderScopeHref(useSearchParams().toString(), { folder: node.path })
 */
export function folderScopeHref(liveQuery: string, scope: FolderScope): string {
  const params = new URLSearchParams(liveQuery);
  writeFolderScope(params, scope);
  params.delete("expanded");
  params.delete("page");
  return `?${params.toString()}`;
}
