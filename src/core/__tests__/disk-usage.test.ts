// The disk usage the Recorder popover shows: the total size of a Recordings
// root, a logs root or the database file, measured on a temporary tree.

import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { diskUsageInBytes } from "@/core/disk-usage";

describe("diskUsageInBytes", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(path.join(tmpdir(), "cca-disk-usage-"));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  /** Write `bytes` bytes at `relativePath` under the temp dir, creating its folders. */
  function writeFileOfSize(relativePath: string, bytes: number) {
    const filePath = path.join(tmpDir, relativePath);
    mkdirSync(path.dirname(filePath), { recursive: true });
    writeFileSync(filePath, Buffer.alloc(bytes));
  }

  it("sums every file under a logs root, through nested folders", async () => {
    writeFileOfSize("logs/-Users-me-dev-a/sess-1.jsonl", 100);
    writeFileOfSize("logs/-Users-me-dev-a/sess-1/subagents/agent-1.jsonl", 40);
    writeFileOfSize("logs/-Users-me-dev-b/sess-2.jsonl", 7);

    expect(await diskUsageInBytes(path.join(tmpDir, "logs"))).toBe(147);
  });

  it("counts an empty folder as 0", async () => {
    mkdirSync(path.join(tmpDir, "recordings"));

    expect(await diskUsageInBytes(path.join(tmpDir, "recordings"))).toBe(0);
  });

  it("counts a missing path as 0", async () => {
    expect(await diskUsageInBytes(path.join(tmpDir, "never-recorded"))).toBe(0);
  });

  it("measures a single file as its own size", async () => {
    writeFileOfSize("analyzer.db", 4096);

    expect(await diskUsageInBytes(path.join(tmpDir, "analyzer.db"))).toBe(4096);
  });

  it("does not follow a symlink into another folder", async () => {
    writeFileOfSize("elsewhere/big.jsonl", 10_000);
    writeFileOfSize("logs/sess.jsonl", 10);
    symlinkSync(path.join(tmpDir, "elsewhere"), path.join(tmpDir, "logs", "linked"));

    expect(await diskUsageInBytes(path.join(tmpDir, "logs"))).toBe(10);
  });
});
