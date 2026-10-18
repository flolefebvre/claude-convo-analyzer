// Refresh progress: `{ done, total }`, where `total` is the number of
// Conversations this run re-parses and `done` counts the ones already
// committed. Writes commit in batches, and each commit is reported once.

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { listConversations } from "@/core/read";
import { refresh, type RefreshProgress } from "@/core/refresh";

const FIXTURES_ROOT = path.join(import.meta.dirname, "fixtures", "logs");

/** Count the stored Conversations through a connection of its own, synchronously. */
function conversationCountOnSecondConnection(dbPath: string): number {
  const db = new Database(dbPath, { readonly: true });
  try {
    return (db.prepare("SELECT count(*) AS count FROM conversation").get() as { count: number }).count;
  } finally {
    db.close();
  }
}

describe("refresh progress", () => {
  let tmpDir: string;
  let dbPath: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(path.join(tmpdir(), "cca-progress-"));
    dbPath = path.join(tmpDir, "analyzer.db");
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("reports the total first, then a rising committed count that ends at the total, on a cold run", async () => {
    const progressReports: RefreshProgress[] = [];
    const summary = await refresh({
      logsRoot: FIXTURES_ROOT,
      dbPath,
      onProgress: (progress) => progressReports.push(progress),
    });

    const total = summary.conversationsParsed;
    expect(total).toBeGreaterThanOrEqual(2);
    expect(progressReports[0]).toEqual({ done: 0, total });
    expect(progressReports.at(-1)).toEqual({ done: total, total });
    for (const [index, progress] of progressReports.entries()) {
      expect(progress.total).toBe(total);
      if (index > 0) expect(progress.done).toBeGreaterThan(progressReports[index - 1]?.done ?? Infinity);
    }
  });

  it("has committed exactly `done` conversations, readable elsewhere, at every report", async () => {
    const conversationCountByDone = new Map<number, number>();
    const summary = await refresh({
      logsRoot: FIXTURES_ROOT,
      dbPath,
      onProgress: ({ done }) => conversationCountByDone.set(done, conversationCountOnSecondConnection(dbPath)),
    });

    // Cold run: exactly `done` conversations are stored at each report — not
    // fewer (reported before its commit), not more (committed but not reported).
    expect(conversationCountByDone.get(summary.conversationsParsed)).toBe(summary.conversationsParsed);
    for (const [done, conversationCount] of conversationCountByDone) {
      expect(conversationCount).toBe(done);
    }
    expect(await listConversations({ dbPath })).toHaveLength(summary.conversationsParsed);
  });

  it("reports a total of 0 when nothing changed", async () => {
    await refresh({ logsRoot: FIXTURES_ROOT, dbPath });

    const progressReports: RefreshProgress[] = [];
    await refresh({ logsRoot: FIXTURES_ROOT, dbPath, onProgress: (progress) => progressReports.push(progress) });

    expect(progressReports).toEqual([{ done: 0, total: 0 }]);
  });
});
