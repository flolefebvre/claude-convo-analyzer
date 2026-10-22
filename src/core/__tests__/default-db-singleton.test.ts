// The default database follows CCA_DB_PATH, and the process-wide client binds to
// it on first use. The variable is stubbed ONCE for the whole file and never
// changed: vitest isolates modules per file, so every case here shares the one
// binding — which is the behaviour under test.

import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { getPrismaClient } from "@/core/db";
import { listConversations } from "@/core/read";
import { refresh } from "@/core/refresh";

const FIXTURES_ROOT = path.join(import.meta.dirname, "fixtures", "logs");

describe("default database configured by CCA_DB_PATH", () => {
  let tmpDir: string;
  let dbPath: string;
  let unconfiguredDbPath: string;

  beforeAll(() => {
    tmpDir = mkdtempSync(path.join(tmpdir(), "cca-default-db-"));
    dbPath = path.join(tmpDir, "nested", "analyzer.db");
    // The home directory is the test's own, so the real one is never read.
    vi.stubEnv("HOME", path.join(tmpDir, "home"));
    vi.stubEnv("USERPROFILE", path.join(tmpDir, "home"));
    unconfiguredDbPath = path.join(homedir(), ".claude-convo-analyzer", "analyzer.db");
    vi.stubEnv("CCA_DB_PATH", dbPath);
  });

  afterAll(async () => {
    await getPrismaClient().$disconnect();
    vi.unstubAllEnvs();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("refresh() with no dbPath creates and migrates the configured file", async () => {
    expect(existsSync(dbPath)).toBe(false);

    const summary = await refresh({ logsRoot: FIXTURES_ROOT });

    expect(existsSync(dbPath)).toBe(true);
    expect(summary.conversationsParsed).toBeGreaterThan(0);
  });

  it("listConversations() with no dbPath reads the configured file", async () => {
    const convos = await listConversations();
    expect(convos.map((c) => c.id)).toContain("sess-basic");
  });

  it("serves the configured database from one process-wide client", () => {
    expect(getPrismaClient()).toBe(getPrismaClient());
  });

  it("never creates the unconfigured ~/.claude-convo-analyzer/analyzer.db", () => {
    expect(existsSync(unconfiguredDbPath)).toBe(false);
  });
});
