// The Refresh the app starts on its own at startup: only when the stored data is
// missing or outdated, and joining any Refresh already running. Driven by
// `createRefreshRunner` with a controlled job and temp databases.

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { startRefreshIfStoredDataIsMissingOrOutdated } from "@/app/_lib/startup-refresh";
import { controlledJob } from "@/core/__tests__/helpers/controlled-job";
import { seededTempDb } from "@/core/__tests__/helpers/temp-db";
import { createRefreshRunner } from "@/core/refresh-runner";

const FIXTURES_ROOT = path.join(import.meta.dirname, "..", "..", "..", "core", "__tests__", "fixtures", "logs");

describe("startRefreshIfStoredDataIsMissingOrOutdated", () => {
  describe("with nothing stored", () => {
    let tmpDir: string;
    let emptyDbPath: string;

    beforeEach(() => {
      tmpDir = mkdtempSync(path.join(tmpdir(), "cca-startup-refresh-"));
      emptyDbPath = path.join(tmpDir, "analyzer.db");
    });

    afterEach(() => {
      rmSync(tmpDir, { recursive: true, force: true });
    });

    it("starts a Refresh whose origin is the startup", async () => {
      const { job, runs } = controlledJob();
      const runner = createRefreshRunner(job);

      await startRefreshIfStoredDataIsMissingOrOutdated({ runner, dbPath: emptyDbPath });

      expect(runs).toHaveLength(1);
      expect(runner.state()).toMatchObject({ status: "running", origin: "startup" });
    });

    it("joins Live's catch-up already running, so the job runs once", async () => {
      const { job, runs } = controlledJob();
      const runner = createRefreshRunner(job);
      const start = vi.spyOn(runner, "start");
      runner.start({ origin: "live" }).catch(() => undefined);

      await startRefreshIfStoredDataIsMissingOrOutdated({ runner, dbPath: emptyDbPath });

      expect(start).toHaveBeenCalledTimes(2);
      expect(runs).toHaveLength(1);
      expect(runner.state()).toMatchObject({ status: "running", origin: "live" });
    });

    it("logs a failed Refresh instead of rejecting", async () => {
      const { job, runs } = controlledJob();
      const runner = createRefreshRunner(job);
      const logError = vi.spyOn(console, "error").mockImplementation(() => undefined);

      await startRefreshIfStoredDataIsMissingOrOutdated({ runner, dbPath: emptyDbPath });
      runs[0]?.fail(new Error("disk gone"));

      await vi.waitFor(() => expect(logError).toHaveBeenCalledOnce());
      logError.mockRestore();
    });

    it("logs a check that cannot read the database, and starts no Refresh", async () => {
      const { job, runs } = controlledJob();
      const runner = createRefreshRunner(job);
      const logError = vi.spyOn(console, "error").mockImplementation(() => undefined);

      // A directory where the database file should be: opening it throws.
      await startRefreshIfStoredDataIsMissingOrOutdated({ runner, dbPath: tmpDir });

      expect(logError).toHaveBeenCalledOnce();
      expect(runs).toHaveLength(0);
      logError.mockRestore();
    });
  });

  describe("with current data stored", () => {
    const db = seededTempDb({ prefix: "cca-startup-refresh-current-", logsRoot: FIXTURES_ROOT });

    it("starts no Refresh", async () => {
      const { job, runs } = controlledJob();
      const runner = createRefreshRunner(job);

      await startRefreshIfStoredDataIsMissingOrOutdated({ runner, dbPath: db.dbPath });

      expect(runs).toHaveLength(0);
      expect(runner.state()).toEqual({ status: "idle" });
    });
  });
});
