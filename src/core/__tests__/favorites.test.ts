// Favorites: the Folders the user keeps at hand, saved in the settings file.

import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { favoriteFolder, listFavoriteFolders, moveFavoriteFolder, unfavoriteFolder } from "@/core/favorites";
import { TRANSCRIPT_FILTER_EVERYTHING, readSettings, writeSettings } from "@/core/settings";

describe("favorites", () => {
  let tmpDir: string;
  let settingsPath: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(path.join(os.tmpdir(), "cca-favorites-"));
    settingsPath = path.join(tmpDir, "analyzer", "settings.json");
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("lists no favorites on a fresh install", async () => {
    await expect(listFavoriteFolders(settingsPath)).resolves.toEqual([]);
  });

  it("lists favorited Folders in the order they were favorited", async () => {
    await favoriteFolder("/home/me/dev/web", settingsPath);
    await favoriteFolder("/home/me/dev/api", settingsPath);

    await expect(listFavoriteFolders(settingsPath)).resolves.toEqual(["/home/me/dev/web", "/home/me/dev/api"]);
  });

  it("keeps a Folder favorited twice once, in its first place", async () => {
    await favoriteFolder("/home/me/dev/web", settingsPath);
    await favoriteFolder("/home/me/dev/api", settingsPath);
    await favoriteFolder("/home/me/dev/web", settingsPath);

    await expect(listFavoriteFolders(settingsPath)).resolves.toEqual(["/home/me/dev/web", "/home/me/dev/api"]);
  });

  it("unfavorites a Folder, keeping the others in order", async () => {
    await favoriteFolder("/home/me/dev/web", settingsPath);
    await favoriteFolder("/home/me/dev/api", settingsPath);
    await favoriteFolder("/home/me/dev/docs", settingsPath);

    await unfavoriteFolder("/home/me/dev/api", settingsPath);

    await expect(listFavoriteFolders(settingsPath)).resolves.toEqual(["/home/me/dev/web", "/home/me/dev/docs"]);
  });

  it("leaves the favorites as they were when unfavoriting a Folder that is not one", async () => {
    await favoriteFolder("/home/me/dev/web", settingsPath);

    await unfavoriteFolder("/home/me/dev/api", settingsPath);

    await expect(listFavoriteFolders(settingsPath)).resolves.toEqual(["/home/me/dev/web"]);
  });

  it("keeps every favorite of quick successive clicks", async () => {
    await Promise.all([
      favoriteFolder("/home/me/dev/web", settingsPath),
      favoriteFolder("/home/me/dev/api", settingsPath),
      favoriteFolder("/home/me/dev/docs", settingsPath),
    ]);

    await expect(listFavoriteFolders(settingsPath)).resolves.toEqual([
      "/home/me/dev/web",
      "/home/me/dev/api",
      "/home/me/dev/docs",
    ]);
  });

  describe("moving a favorite", () => {
    beforeEach(async () => {
      await writeSettings(
        {
          live: true,
          favorites: ["/home/me/dev/web", "/home/me/dev/api", "/home/me/dev/docs"],
          transcriptFilter: TRANSCRIPT_FILTER_EVERYTHING,
        },
        settingsPath,
      );
    });

    it("puts a favorite immediately before another", async () => {
      await moveFavoriteFolder("/home/me/dev/docs", "/home/me/dev/api", settingsPath);

      await expect(listFavoriteFolders(settingsPath)).resolves.toEqual([
        "/home/me/dev/web",
        "/home/me/dev/docs",
        "/home/me/dev/api",
      ]);
    });

    it("moves a favorite to the top", async () => {
      await moveFavoriteFolder("/home/me/dev/api", "/home/me/dev/web", settingsPath);

      await expect(listFavoriteFolders(settingsPath)).resolves.toEqual([
        "/home/me/dev/api",
        "/home/me/dev/web",
        "/home/me/dev/docs",
      ]);
    });

    it("moves a favorite last when it goes before none", async () => {
      await moveFavoriteFolder("/home/me/dev/web", null, settingsPath);

      await expect(listFavoriteFolders(settingsPath)).resolves.toEqual([
        "/home/me/dev/api",
        "/home/me/dev/docs",
        "/home/me/dev/web",
      ]);
    });

    it("keeps a hidden favorite between its neighbours when a shown one moves past it", async () => {
      // `/home/me/dev/api` has no Conversations: the Favorites section shows web, then docs.
      await moveFavoriteFolder("/home/me/dev/web", null, settingsPath);
      await moveFavoriteFolder("/home/me/dev/web", "/home/me/dev/docs", settingsPath);

      await expect(listFavoriteFolders(settingsPath)).resolves.toEqual([
        "/home/me/dev/api",
        "/home/me/dev/web",
        "/home/me/dev/docs",
      ]);
    });

    it("leaves the favorites as they were when the moved Folder is no favorite", async () => {
      await moveFavoriteFolder("/home/me/dev/gone", "/home/me/dev/web", settingsPath);

      await expect(listFavoriteFolders(settingsPath)).resolves.toEqual([
        "/home/me/dev/web",
        "/home/me/dev/api",
        "/home/me/dev/docs",
      ]);
    });

    it("leaves the favorites as they were when the Folder to go before is no favorite", async () => {
      await moveFavoriteFolder("/home/me/dev/docs", "/home/me/dev/gone", settingsPath);

      await expect(listFavoriteFolders(settingsPath)).resolves.toEqual([
        "/home/me/dev/web",
        "/home/me/dev/api",
        "/home/me/dev/docs",
      ]);
    });

    it("keeps a favorite added while it moves, and the user's Live choice", async () => {
      await Promise.all([
        moveFavoriteFolder("/home/me/dev/docs", "/home/me/dev/web", settingsPath),
        favoriteFolder("/home/me/dev/cli", settingsPath),
      ]);

      await expect(readSettings(settingsPath)).resolves.toEqual({
        live: true,
        favorites: ["/home/me/dev/docs", "/home/me/dev/web", "/home/me/dev/api", "/home/me/dev/cli"],
        transcriptFilter: TRANSCRIPT_FILTER_EVERYTHING,
      });
    });
  });

  it("keeps the user's Live choice when favoriting", async () => {
    await writeSettings({ live: true, favorites: [], transcriptFilter: TRANSCRIPT_FILTER_EVERYTHING }, settingsPath);

    await favoriteFolder("/home/me/dev/web", settingsPath);

    await expect(readSettings(settingsPath)).resolves.toEqual({
      live: true,
      favorites: ["/home/me/dev/web"],
      transcriptFilter: TRANSCRIPT_FILTER_EVERYTHING,
    });
  });
});
