// The disk-usage route, driven through its pipe against the default paths:
// the database and Recordings root of `refreshedDefaultDatabase`, and a logs
// root stubbed at a temp tree of known size.

import { existsSync, mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { measureDiskUsage } from "@/app/_lib/disk-usage";

import { coreFixtureLogsRoot, refreshedDefaultDatabase } from "../__tests__/helpers/default-database";
import { GET } from "./route";

describe("GET /api/disk-usage", () => {
  const db = refreshedDefaultDatabase({ prefix: "cca-disk-usage-route-", logsRoot: coreFixtureLogsRoot("logs") });
  let logsRoot = "";

  beforeAll(() => {
    // Written after the Refresh, which would otherwise read them.
    mkdirSync(path.join(db.recordingsRoot, "2026-10-19"), { recursive: true });
    writeFileSync(path.join(db.recordingsRoot, "2026-10-19", "sess-a.jsonl.gz"), Buffer.alloc(2048));
    logsRoot = mkdtempSync(path.join(tmpdir(), "cca-disk-usage-logs-"));
    mkdirSync(path.join(logsRoot, "-Users-me-dev-a"));
    writeFileSync(path.join(logsRoot, "-Users-me-dev-a", "sess-a.jsonl"), Buffer.alloc(300));
    vi.stubEnv("CCA_LOGS_ROOT", logsRoot);
  });

  afterAll(() => {
    rmSync(logsRoot, { recursive: true, force: true });
  });

  it("answers the size and path of the Recordings, the database and the logs", async () => {
    const res = await GET(new Request("http://localhost/api/disk-usage"), { params: Promise.resolve({}) });
    const dbPath = process.env.CCA_DB_PATH ?? "";

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({
      recordings: { path: db.recordingsRoot, bytes: 2048 },
      database: { path: dbPath, bytes: expect.any(Number) },
      logs: { path: logsRoot, bytes: 300 },
    });
  });

  it("counts the database's WAL sidecars in its size", async () => {
    const dbPath = process.env.CCA_DB_PATH ?? "";
    // The Refresh closed the database and checkpointed its WAL away; stand in for an open one's sidecars.
    expect(existsSync(`${dbPath}-wal`) || existsSync(`${dbPath}-shm`)).toBe(false);
    writeFileSync(`${dbPath}-wal`, Buffer.alloc(500));
    writeFileSync(`${dbPath}-shm`, Buffer.alloc(70));

    const res = await GET(new Request("http://localhost/api/disk-usage"), { params: Promise.resolve({}) });

    expect((await res.json()).database.bytes).toBe(statSync(dbPath).size + 570);
    rmSync(`${dbPath}-wal`);
    rmSync(`${dbPath}-shm`);
  });

  it("gives concurrent callers the one measurement in flight", async () => {
    const first = measureDiskUsage();

    expect(measureDiskUsage()).toBe(first);
    await first;
  });
});
