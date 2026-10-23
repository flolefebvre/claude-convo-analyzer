import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { defaultDbPath } from "@/core/db";
import { defaultLogsRoot } from "@/core/discovery";
import { listConversations } from "@/core/read";
import { refresh } from "@/core/refresh";
import { defaultSettingsPath } from "@/core/settings";

const FIXTURES_ROOT = path.join(import.meta.dirname, "fixtures", "logs");

describe("default database path", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("is ~/.claude-convo-analyzer/analyzer.db when CCA_DB_PATH is unset", () => {
    vi.stubEnv("CCA_DB_PATH", undefined);
    expect(defaultDbPath()).toBe(path.join(os.homedir(), ".claude-convo-analyzer", "analyzer.db"));
  });

  it("treats an empty CCA_DB_PATH as unset", () => {
    vi.stubEnv("CCA_DB_PATH", "");
    expect(defaultDbPath()).toBe(path.join(os.homedir(), ".claude-convo-analyzer", "analyzer.db"));
  });

  it("is CCA_DB_PATH when it is absolute", () => {
    const absoluteDbPath = path.join(os.tmpdir(), "elsewhere", "seed.db");
    vi.stubEnv("CCA_DB_PATH", absoluteDbPath);
    expect(defaultDbPath()).toBe(absoluteDbPath);
  });

  it("resolves a relative CCA_DB_PATH against the cwd", () => {
    vi.stubEnv("CCA_DB_PATH", "data/seed.db");
    expect(defaultDbPath()).toBe(path.join(process.cwd(), "data", "seed.db"));
  });
});

describe("default logs root", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("is ~/.claude/projects when CCA_LOGS_ROOT is unset", () => {
    vi.stubEnv("CCA_LOGS_ROOT", undefined);
    expect(defaultLogsRoot()).toBe(path.join(os.homedir(), ".claude", "projects"));
  });

  it("treats an empty CCA_LOGS_ROOT as unset", () => {
    vi.stubEnv("CCA_LOGS_ROOT", "");
    expect(defaultLogsRoot()).toBe(path.join(os.homedir(), ".claude", "projects"));
  });

  it("resolves a relative CCA_LOGS_ROOT against the cwd", () => {
    vi.stubEnv("CCA_LOGS_ROOT", "seed/logs");
    expect(defaultLogsRoot()).toBe(path.join(process.cwd(), "seed", "logs"));
  });

  it("is where refresh() with no logsRoot discovers Conversations", async () => {
    const tmpDir = mkdtempSync(path.join(os.tmpdir(), "cca-default-logs-"));
    try {
      const dbPath = path.join(tmpDir, "analyzer.db");
      vi.stubEnv("CCA_LOGS_ROOT", FIXTURES_ROOT);

      await refresh({ dbPath });

      const convos = await listConversations({ dbPath });
      expect(convos.map((c) => c.id)).toContain("sess-basic");
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

describe("default settings path", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("is ~/.claude-convo-analyzer/settings.json when CCA_SETTINGS_PATH is unset", () => {
    vi.stubEnv("CCA_SETTINGS_PATH", undefined);
    expect(defaultSettingsPath()).toBe(path.join(os.homedir(), ".claude-convo-analyzer", "settings.json"));
  });

  it("treats an empty CCA_SETTINGS_PATH as unset", () => {
    vi.stubEnv("CCA_SETTINGS_PATH", "");
    expect(defaultSettingsPath()).toBe(path.join(os.homedir(), ".claude-convo-analyzer", "settings.json"));
  });

  it("resolves a relative CCA_SETTINGS_PATH against the cwd", () => {
    vi.stubEnv("CCA_SETTINGS_PATH", "data/seed/settings.json");
    expect(defaultSettingsPath()).toBe(path.join(process.cwd(), "data", "seed", "settings.json"));
  });
});
