// The sidebar's Favorites section (GLOSSARY.md, **Favorite**), derived from the
// favorited paths and the per-Project folder entries. A favorite's totals come
// from the scope rule, not from a tree lookup, so a favorite stays visible
// whatever shape the tree takes around it — inside a compacted chain included.
//
// React-free + I/O-free, like its sibling `_lib` modules: the paths are read at
// the server edge (`loadFavoriteFolderPaths`).

import { isProjectInFolderScope } from "@/app/_lib/folder-scope";
import type { FolderTotals } from "@/app/_lib/folder-tree";
import { disambiguateLabels, type FolderEntry, friendlyFolderName, newestFirst } from "@/app/_lib/folders";

/** One row of the Favorites section, with the totals of every Project at or below it. */
export type FavoriteFolder = FolderTotals & {
  /** The favorited Folder's absolute path — the `?folder=` value. */
  path: string;
  /** Its basename, widened to a minimal path suffix when two favorites share one. */
  label: string;
  /** Latest activity over the Projects at or below it, as an ISO string. */
  latestActivity: string;
};

/** The home directory's label, as the folder tree shows its root. */
const HOME_LABEL = "~";

/**
 * The Favorites section's rows: each favorite with Conversations at or below
 * it, newest activity first; a favorite with none is left out. The favorited
 * `home` is labelled `~`, as the folder tree labels it.
 *
 * @example deriveFavoriteFolders(await loadFavoriteFolderPaths(), folders, homeDirectory())
 */
export function deriveFavoriteFolders(favoritePaths: string[], folders: FolderEntry[], home: string): FavoriteFolder[] {
  const favorites: FavoriteFolder[] = [];
  for (const favoritePath of favoritePaths) {
    const inScope = folders.filter((entry) => isProjectInFolderScope(entry.path, { folder: favoritePath }));
    if (inScope.length === 0) continue;
    favorites.push({
      path: favoritePath,
      label: favoritePath === home ? HOME_LABEL : friendlyFolderName(favoritePath),
      count: inScope.reduce((sum, entry) => sum + entry.count, 0),
      costUsd: inScope.reduce((sum, entry) => sum + entry.costUsd, 0),
      unpriced: inScope.some((entry) => entry.unpriced),
      latestActivity: inScope.reduce(
        (latest, entry) => (entry.latestActivity > latest ? entry.latestActivity : latest),
        "",
      ),
    });
  }
  disambiguateLabels(favorites);
  return favorites.sort(newestFirst);
}
