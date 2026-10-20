// Favorites (GLOSSARY.md, **Favorite**): the Folders the user keeps at hand,
// kept in the settings file by their absolute paths, in the user's order: the
// order they were favorited, until the user moves one. Being user-owned, they
// live there rather than in the database, so neither a Refresh nor a database
// reset touches them.

import { defaultSettingsPath, readSettings, updateSettings } from "@/core/settings";

/**
 * The favorited Folders' absolute paths, in the user's order.
 *
 * @example const favoritePaths = await listFavoriteFolders(); // ["/home/me/dev/acme-api"]
 */
export async function listFavoriteFolders(settingsPath = defaultSettingsPath()): Promise<string[]> {
  return (await readSettings(settingsPath)).favorites;
}

/**
 * Favorite the Folder at `folderPath`, after the favorites already there; a
 * Folder already favorited keeps its place.
 *
 * @example await favoriteFolder("/home/me/dev/acme-api");
 */
export function favoriteFolder(folderPath: string, settingsPath = defaultSettingsPath()): Promise<void> {
  return updateSettings(
    ({ favorites }) => ({ favorites: favorites.includes(folderPath) ? favorites : [...favorites, folderPath] }),
    settingsPath,
  );
}

/**
 * Move the favorite at `folderPath` immediately before the favorite at
 * `beforeFolderPath`, or last when that is null. Every other favorite, shown
 * in the Favorites section or not, keeps its place; nothing changes when
 * either path is no favorite.
 *
 * @example await moveFavoriteFolder("/home/me/dev/acme-api", "/home/me/dev/web-dashboard");
 */
export function moveFavoriteFolder(
  folderPath: string,
  beforeFolderPath: string | null,
  settingsPath = defaultSettingsPath(),
): Promise<void> {
  return updateSettings(({ favorites }) => {
    const isMoveOfFavorites =
      favorites.includes(folderPath) && (beforeFolderPath === null || favorites.includes(beforeFolderPath));
    if (!isMoveOfFavorites || folderPath === beforeFolderPath) return { favorites };
    const others = favorites.filter((favoritePath) => favoritePath !== folderPath);
    const insertionIndex = beforeFolderPath === null ? others.length : others.indexOf(beforeFolderPath);
    return { favorites: others.toSpliced(insertionIndex, 0, folderPath) };
  }, settingsPath);
}

/**
 * Unfavorite the Folder at `folderPath`; nothing changes when it is not a favorite.
 *
 * @example await unfavoriteFolder("/home/me/dev/acme-api");
 */
export function unfavoriteFolder(folderPath: string, settingsPath = defaultSettingsPath()): Promise<void> {
  return updateSettings(
    ({ favorites }) => ({ favorites: favorites.filter((favoritePath) => favoritePath !== folderPath) }),
    settingsPath,
  );
}
