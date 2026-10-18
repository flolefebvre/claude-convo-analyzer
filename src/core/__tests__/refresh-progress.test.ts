// Refresh progress: `{ done, total }`, where `total` is the number of
// Conversations this run re-parses and `done` counts the ones already written.

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

  it("reports the total first, then one step per written conversation, on a cold run", async () => {
    const progressReports: RefreshProgress[] = [];
    const summary = await refresh({
      logsRoot: FIXTURES_ROOT,
      dbPath,
      onProgress: (progress) => progressReports.push(progress),
    });

    const total = summary.conversationsParsed;
    expect(total).toBeGreaterThanOrEqual(2);
    expect(progressReports).toEqual(Array.from({ length: total + 1 }, (_, done) => ({ done, total })));
  });

  it("has written conversation k, readable elsewhere, by the time it reports k done", async () => {
    const conversationCountByDone = new Map<number, number>();
    const summary = await refresh({
      logsRoot: FIXTURES_ROOT,
      dbPath,
      onProgress: ({ done }) => conversationCountByDone.set(done, conversationCountOnSecondConnection(dbPath)),
    });

    // Cold run: exactly `done` conversations are stored at each report — not
    // fewer (written before the report), not more (written as parsed, not batched).
    expect(conversationCountByDone.size).toBe(summary.conversationsParsed + 1);
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
