import path from "node:path";
import { describe, expect, it } from "vitest";

import { getToolStats } from "@/core/tool-stats";

import { seededTempDb } from "./helpers/temp-db";

const FIXTURES_ROOT = path.join(import.meta.dirname, "fixtures", "logs");

const TOOLS_FOLDER = "-Users-me-dev-toolstats";
const OTHER_FOLDER = "-Users-me-dev-toolscope";
const NOW = Date.parse("2026-06-20T18:00:00.000Z");

describe("getToolStats", () => {
  const db = seededTempDb({ prefix: "cca-tools-", logsRoot: FIXTURES_ROOT });

  async function statFor(name: string) {
    const stats = await getToolStats({
      dbPath: db.dbPath,
      folder: TOOLS_FOLDER,
      now: NOW,
    });
    return stats.tools.find((t) => t.name === name);
  }

  it("counts one row per tool name, with its error count and rate", async () => {
    const bash = await statFor("Bash");
    expect(bash?.calls).toBe(5);
    expect(bash?.errors).toBe(1);
    expect(bash?.errorRate).toBeCloseTo(1 / 5, 12);

    const mcp = await statFor("mcp__github__create_issue");
    expect(mcp?.calls).toBe(2);
    expect(mcp?.errors).toBe(1);
    expect(mcp?.errorRate).toBeCloseTo(0.5, 12);
  });

  it("includes sub-agent tool calls in the aggregates", async () => {
    const bash = await statFor("Bash");
    expect(bash?.calls).toBe(5);
    expect(bash?.maxSize).toBe(100);
  });

  it("reports mean, nearest-rank p50/p95, largest, and total result size", async () => {
    const bash = await statFor("Bash");
    expect(bash?.meanSize).toBe(40);
    expect(bash?.p50Size).toBe(30);
    expect(bash?.p95Size).toBe(100);
    expect(bash?.maxSize).toBe(100);
    expect(bash?.totalSize).toBe(200);
  });

  it("counts an unpaired call but leaves it out of the size stats", async () => {
    const grep = await statFor("Grep");
    expect(grep?.calls).toBe(2);
    expect(grep?.sizedCalls).toBe(1);
    expect(grep?.meanSize).toBe(8);
    expect(grep?.p50Size).toBe(8);
    expect(grep?.p95Size).toBe(8);
    expect(grep?.maxSize).toBe(8);
    expect(grep?.totalSize).toBe(8);
  });

  it("orders tools by call count, and rolls the scope up", async () => {
    const stats = await getToolStats({
      dbPath: db.dbPath,
      folder: TOOLS_FOLDER,
      now: NOW,
    });

    expect(stats.tools[0]?.name).toBe("Bash");
    expect(stats.totalCalls).toBe(15);
    expect(stats.totalErrors).toBe(5);
  });

  it("scopes to one Project, leaving the other Project's calls out", async () => {
    const scoped = await getToolStats({
      dbPath: db.dbPath,
      folder: OTHER_FOLDER,
      now: NOW,
    });

    expect(scoped.tools.map((t) => t.name)).toEqual(["Bash"]);
    expect(scoped.tools[0]?.calls).toBe(1);
    expect(scoped.tools[0]?.totalSize).toBe(7);
  });

  it("scopes by the turn's timestamp, in local days ending today", async () => {
    const inRange = await getToolStats({
      dbPath: db.dbPath,
      folder: TOOLS_FOLDER,
      days: 7,
      now: NOW,
    });
    expect(inRange.totalCalls).toBe(15);

    const after = await getToolStats({
      dbPath: db.dbPath,
      folder: TOOLS_FOLDER,
      days: 7,
      now: Date.parse("2026-07-20T12:00:00.000Z"),
    });
    expect(after.tools).toEqual([]);
    expect(after.totalCalls).toBe(0);
  });
});
