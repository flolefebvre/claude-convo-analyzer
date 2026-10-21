// Shared setup of the route tests: a route handler reads the DEFAULT database,
// so each test file stubs it ONCE to a temp directory —
// the process-wide client binds to `CCA_DB_PATH` on first use (see
// `default-db-singleton.test.ts`) — and Refreshes its fixture logs into it.

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, vi } from "vitest";

import { getPrismaClient } from "@/core/db";
import { refresh } from "@/core/refresh";

// Outside Next there is no request scope for `connection()` to find: stand in
// for the one Next opens around every route handler call. Registered here, so
// a test file imports this helper before its route.
vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  connection: async () => {},
}));

/**
 * The core fixture logs root named `fixtureName` (`src/core/__tests__/fixtures/<fixtureName>`).
 *
 * @example const logsRoot = coreFixtureLogsRoot("tool-body-logs");
 */
export function coreFixtureLogsRoot(fixtureName: string): string {
  return path.join(process.cwd(), "src", "core", "__tests__", "fixtures", fixtureName);
}

/**
 * Register, at file scope, a temp default database: `logsRoot` is Refreshed
 * into it, and it is removed after the file.
 *
 * @example refreshedDefaultDatabase({ prefix: "cca-route-", logsRoot });
 */
export function refreshedDefaultDatabase(opts: {
  /** `mkdtemp` prefix, so a leaked directory names its owner. */
  prefix: string;
  logsRoot: string;
}): void {
  let scratchDir = "";

  beforeAll(async () => {
    scratchDir = mkdtempSync(path.join(tmpdir(), opts.prefix));
    vi.stubEnv("CCA_DB_PATH", path.join(scratchDir, "analyzer.db"));
    await refresh({ logsRoot: opts.logsRoot });
  });

  afterAll(async () => {
    await getPrismaClient().$disconnect();
    vi.unstubAllEnvs();
    rmSync(scratchDir, { recursive: true, force: true });
  });
}
