// The default database follows CCA_DB_PATH, and the process-wide client binds to
// it on first use. The variable is stubbed ONCE for the whole file and never
// changed: vitest isolates modules per file, so every case here shares the one
// binding — which is the behaviour under test.

import { existsSync, mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { getPrismaClient } from "@/core/db";
import { listConversations } from "@/core/read";
import { refresh } from "@/core/refresh";

const FIXTURES_ROOT = path.join(import.meta.dirname, "fixtures", "logs");
const UNCONFIGURED_DB = path.join(process.cwd(), "data", "analyzer.db");

/** Existence and mtime of a file, to show it was left alone. */
function fingerprint(file: string): string {
  return existsSync(file) ? `mtime:${statSync(file).mtimeMs}` : "absent";
}

describe("default database configured by CCA_DB_PATH", () => {
  let tmpDir: string;
  let dbPath: string;
  let unconfiguredBefore: string;

  beforeAll(() => {
    tmpDir = mkdtempSync(path.join(tmpdir(), "cca-default-db-"));
    dbPath = path.join(tmpDir, "nested", "analyzer.db");
    unconfiguredBefore = fingerprint(UNCONFIGURED_DB);
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

  it("leaves the unconfigured ./data/analyzer.db untouched", () => {
    expect(fingerprint(UNCONFIGURED_DB)).toBe(unconfiguredBefore);
  });
});
