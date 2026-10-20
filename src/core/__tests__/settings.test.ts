// The settings file: the user's choices that outlive the server, Live first.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readSettings, updateSettings, writeSettings } from "@/core/settings";

describe("settings", () => {
  let tmpDir: string;
  let settingsPath: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(path.join(os.tmpdir(), "cca-settings-"));
    settingsPath = path.join(tmpDir, "analyzer", "settings.json");
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("reads Live as off on a fresh install, with no settings file", async () => {
    await expect(readSettings(settingsPath)).resolves.toEqual({ live: false, favorites: [] });
  });

  it("reads back what was written, creating the file's directory", async () => {
    await writeSettings({ live: true, favorites: ["/home/me/dev/api"] }, settingsPath);

    await expect(readSettings(settingsPath)).resolves.toEqual({ live: true, favorites: ["/home/me/dev/api"] });
  });

  it("reads a file that is not valid JSON as the defaults", async () => {
    mkdirSync(path.dirname(settingsPath), { recursive: true });
    writeFileSync(settingsPath, "{ live: tru");

    await expect(readSettings(settingsPath)).resolves.toEqual({ live: false, favorites: [] });
  });

  it("reads a setting of the wrong type as its default", async () => {
    mkdirSync(path.dirname(settingsPath), { recursive: true });
    writeFileSync(settingsPath, JSON.stringify({ live: "yes", favorites: ["/home/me/dev/api"] }));

    await expect(readSettings(settingsPath)).resolves.toEqual({ live: false, favorites: ["/home/me/dev/api"] });
  });

  it("keeps the favorites when Live is switched", async () => {
    await writeSettings({ live: false, favorites: ["/home/me/dev/api"] }, settingsPath);

    await updateSettings({ live: true }, settingsPath);

    await expect(readSettings(settingsPath)).resolves.toEqual({ live: true, favorites: ["/home/me/dev/api"] });
  });

  it("applies a change computed from the settings saved before it", async () => {
    await writeSettings({ live: true, favorites: ["/home/me/dev/api"] }, settingsPath);

    await updateSettings(({ favorites }) => ({ favorites: [...favorites, "/home/me/dev/web"] }), settingsPath);

    await expect(readSettings(settingsPath)).resolves.toEqual({
      live: true,
      favorites: ["/home/me/dev/api", "/home/me/dev/web"],
    });
  });

  it("fails only the write that failed, saving the next one", async () => {
    const notADirectory = path.join(tmpDir, "not-a-directory");
    writeFileSync(notADirectory, "");

    const failedWrite = updateSettings({ live: true }, path.join(notADirectory, "settings.json"));
    const nextWrite = updateSettings({ live: true }, settingsPath);

    await expect(failedWrite).rejects.toThrow();
    await expect(nextWrite).resolves.toBeUndefined();
    await expect(readSettings(settingsPath)).resolves.toEqual({ live: true, favorites: [] });
  });
});
