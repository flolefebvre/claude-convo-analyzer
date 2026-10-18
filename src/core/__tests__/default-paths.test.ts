import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { defaultDbPath } from "@/core/db";
import { defaultLogsRoot } from "@/core/discovery";
import { listConversations } from "@/core/read";
import { defaultRecorderPort, defaultRecorderUpstream } from "@/core/recorder";
import { defaultRecordingsRoot } from "@/core/recording";
import { refresh } from "@/core/refresh";

const FIXTURES_ROOT = path.join(import.meta.dirname, "fixtures", "logs");

describe("default database path", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("is ./data/analyzer.db under the cwd when CCA_DB_PATH is unset", () => {
    vi.stubEnv("CCA_DB_PATH", undefined);
    expect(defaultDbPath()).toBe(path.join(process.cwd(), "data", "analyzer.db"));
  });

  it("treats an empty CCA_DB_PATH as unset", () => {
    vi.stubEnv("CCA_DB_PATH", "");
    expect(defaultDbPath()).toBe(path.join(process.cwd(), "data", "analyzer.db"));
  });

  it("is CCA_DB_PATH when it is absolute", () => {
    vi.stubEnv("CCA_DB_PATH", "/tmp/elsewhere/seed.db");
    expect(defaultDbPath()).toBe("/tmp/elsewhere/seed.db");
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

describe("default Recordings root", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("is ~/.claude-convo-analyzer/recordings when CCA_RECORDINGS_ROOT is unset", () => {
    vi.stubEnv("CCA_RECORDINGS_ROOT", undefined);
    expect(defaultRecordingsRoot()).toBe(path.join(os.homedir(), ".claude-convo-analyzer", "recordings"));
  });

  it("treats an empty CCA_RECORDINGS_ROOT as unset", () => {
    vi.stubEnv("CCA_RECORDINGS_ROOT", "");
    expect(defaultRecordingsRoot()).toBe(path.join(os.homedir(), ".claude-convo-analyzer", "recordings"));
  });

  it("resolves a relative CCA_RECORDINGS_ROOT against the cwd", () => {
    vi.stubEnv("CCA_RECORDINGS_ROOT", "data/recordings");
    expect(defaultRecordingsRoot()).toBe(path.join(process.cwd(), "data", "recordings"));
  });
});

describe("default Recorder port and upstream", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("are 4242 and https://api.anthropic.com when CCA_RECORDER_PORT and CCA_RECORDER_UPSTREAM are empty", () => {
    vi.stubEnv("CCA_RECORDER_PORT", "");
    vi.stubEnv("CCA_RECORDER_UPSTREAM", "");
    expect(defaultRecorderPort()).toBe(4242);
    expect(defaultRecorderUpstream()).toBe("https://api.anthropic.com");
  });

  it("are CCA_RECORDER_PORT and CCA_RECORDER_UPSTREAM when set", () => {
    vi.stubEnv("CCA_RECORDER_PORT", "5151");
    vi.stubEnv("CCA_RECORDER_UPSTREAM", "https://gateway.example/anthropic");
    expect(defaultRecorderPort()).toBe(5151);
    expect(defaultRecorderUpstream()).toBe("https://gateway.example/anthropic");
  });

  it("rejects a CCA_RECORDER_PORT that is not a port number", () => {
    vi.stubEnv("CCA_RECORDER_PORT", "42a");
    expect(() => defaultRecorderPort()).toThrow(/CCA_RECORDER_PORT/);
    vi.stubEnv("CCA_RECORDER_PORT", "70000");
    expect(() => defaultRecorderPort()).toThrow(/CCA_RECORDER_PORT/);
  });
});
