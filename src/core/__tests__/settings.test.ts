// The settings file: the user's choices that outlive the server, Live first.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readSettings, writeSettings } from "@/core/settings";

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
    await expect(readSettings(settingsPath)).resolves.toEqual({ live: false });
  });

  it("reads back what was written, creating the file's directory", async () => {
    await writeSettings({ live: true }, settingsPath);

    await expect(readSettings(settingsPath)).resolves.toEqual({ live: true });
  });

  it("reads a file that is not valid JSON as the defaults", async () => {
    mkdirSync(path.dirname(settingsPath), { recursive: true });
    writeFileSync(settingsPath, "{ live: tru");

    await expect(readSettings(settingsPath)).resolves.toEqual({ live: false });
  });

  it("reads a setting of the wrong type as its default", async () => {
    mkdirSync(path.dirname(settingsPath), { recursive: true });
    writeFileSync(settingsPath, JSON.stringify({ live: "yes" }));

    await expect(readSettings(settingsPath)).resolves.toEqual({ live: false });
  });
});
