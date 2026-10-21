// The watcher Live runs on: real `fs.watch` over a temp directory standing in
// for the logs root. Delivery timing varies under load, so each test waits for
// the change itself, never a fixed sleep.

import { appendFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type LiveWatcher, watchLogs } from "@/core/live";

const CHANGE_TIMEOUT_MS = 10_000;

describe("Live's watcher over the logs", () => {
  let tmpDir: string;
  let logsRoot: string;
  let watcher: LiveWatcher | null;

  beforeEach(() => {
    tmpDir = mkdtempSync(path.join(os.tmpdir(), "cca-live-watcher-"));
    logsRoot = path.join(tmpDir, "projects");
    watcher = null;
  });

  afterEach(() => {
    watcher?.close();
    vi.restoreAllMocks();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  /** Watch the logs root; resolves on the first change reported. */
  function watchForFirstChange(): Promise<void> {
    return new Promise((resolve, reject) => {
      watcher = watchLogs({ logsRoot })({ onChange: resolve, onError: reject });
    });
  }

  it(
    "reports a change when a log file is appended to, in a log folder",
    async () => {
      const logFolder = path.join(logsRoot, "-home-me-repo");
      mkdirSync(logFolder, { recursive: true });
      writeFileSync(path.join(logFolder, "sess-a.jsonl"), "{}\n");

      const firstChange = watchForFirstChange();
      appendFileSync(path.join(logFolder, "sess-a.jsonl"), "{}\n");

      await expect(firstChange).resolves.toBeUndefined();
    },
    CHANGE_TIMEOUT_MS,
  );

  it("skips a missing logs root with one warning, and watches nothing", () => {
    const consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    watcher = watchLogs({ logsRoot })({ onChange: () => undefined, onError: () => undefined });

    expect(consoleWarn).toHaveBeenCalledOnce();
    expect(consoleWarn.mock.calls[0]?.join(" ")).toContain(logsRoot);
  });
});
