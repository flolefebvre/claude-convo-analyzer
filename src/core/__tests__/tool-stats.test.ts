import path from "node:path";
import { describe, expect, it } from "vitest";

import { getToolStats } from "@/core/tool-stats";

import { seededTempDb } from "./helpers/temp-db";

const FIXTURES_ROOT = path.join(import.meta.dirname, "fixtures", "logs");

/** The Project the tool-stats fixture lives in (the `?folder=` scope key). */
const TOOLS_FOLDER = "-Users-me-dev-toolstats";
/** A second Project with one Bash call, used for scope assertions. */
const OTHER_FOLDER = "-Users-me-dev-toolscope";
/** "Now" for every read — the day the fixture's tool calls ran. */
const NOW = Date.parse("2026-06-20T18:00:00.000Z");

describe("getToolStats", () => {
  const db = seededTempDb({ prefix: "cca-tools-", logsRoot: FIXTURES_ROOT });

  /** The stats of one tool in the fixture's Project, over all time. */
  async function statFor(name: string) {
    const stats = await getToolStats({
      dbPath: db.dbPath,
      folder: TOOLS_FOLDER,
      now: NOW,
    });
    return stats.tools.find((t) => t.name === name);
  }

  it("counts one row per tool name, with its error count and rate", async () => {
    // Bash: 4 main-thread calls (one errored) + 1 sub-agent call.
    const bash = await statFor("Bash");
    expect(bash?.calls).toBe(5);
    expect(bash?.errors).toBe(1);
    expect(bash?.errorRate).toBeCloseTo(1 / 5, 12);

    // The MCP tool keeps its raw logged name — the "server · tool" split is a
    // rendering concern, not a data one.
    const mcp = await statFor("mcp__github__create_issue");
    expect(mcp?.calls).toBe(2);
    expect(mcp?.errors).toBe(1);
    expect(mcp?.errorRate).toBeCloseTo(0.5, 12);
  });

  it("includes sub-agent tool calls in the aggregates", async () => {
    // The 100-char result exists ONLY in the sub-agent transcript: were
    // sub-agent calls dropped, both the count and the largest result would fall.
    const bash = await statFor("Bash");
    expect(bash?.calls).toBe(5);
    expect(bash?.maxSize).toBe(100);
  });

  it("reports mean, nearest-rank p50/p95, largest, and total result size", async () => {
    // Bash result sizes: 10, 20, 30, 40 (main) and 100 (sub-agent).
    // Nearest rank on 5 values: p50 → index 2 (30), p95 → index 4 (100).
    const bash = await statFor("Bash");
    expect(bash?.meanSize).toBe(40);
    expect(bash?.p50Size).toBe(30);
    expect(bash?.p95Size).toBe(100);
    expect(bash?.maxSize).toBe(100);
    expect(bash?.totalSize).toBe(200);
  });

  it("counts an unpaired call but leaves it out of the size stats", async () => {
    // Grep ran twice: one call never got its result (NULL size), one returned
    // 8 chars. The call still counts; only the size stats ignore it.
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
    // 5 Bash + 3 Edit + 2 Grep + 2 MCP + 2 Skill + 1 Agent.
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
    // A 7-day range ending on the fixture's own day keeps its calls…
    const inRange = await getToolStats({
      dbPath: db.dbPath,
      folder: TOOLS_FOLDER,
      days: 7,
      now: NOW,
    });
    expect(inRange.totalCalls).toBe(15);

    // …while a 7-day range weeks later contains nothing at all.
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
