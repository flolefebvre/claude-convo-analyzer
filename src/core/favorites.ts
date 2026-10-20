// Favorites (GLOSSARY.md, **Favorite**): the Folders the user keeps at hand,
// kept in the settings file by their absolute paths, in the order they were
// favorited. Being user-owned, they live there rather than in the database, so
// neither a Refresh nor a database reset touches them.

import { defaultSettingsPath, readSettings, updateSettings } from "@/core/settings";

/**
 * The favorited Folders' absolute paths, in the order they were favorited.
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
