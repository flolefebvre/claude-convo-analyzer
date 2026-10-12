import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { defaultDbPath } from "@/core/db";

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
