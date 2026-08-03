import path from "node:path";
import { describe, expect, it } from "vitest";

import { getToolCallSamples } from "@/core/tool-stats";

import { seededTempDb } from "./helpers/temp-db";

const FIXTURES_ROOT = path.join(import.meta.dirname, "fixtures", "logs");

/** The Project the tool-stats fixture lives in (the `?folder=` scope key). */
const TOOLS_FOLDER = "-Users-me-dev-toolstats";
/** "Now" for every read — the day the fixture's tool calls ran. */
const NOW = Date.parse("2026-06-20T18:00:00.000Z");

describe("getToolCallSamples", () => {
  const db = seededTempDb({ prefix: "cca-samples-", logsRoot: FIXTURES_ROOT });

  /** One tool's drill-down within the fixture's Project, over all time. */
  function samplesFor(name: string, opts: { limit?: number } = {}) {
    return getToolCallSamples(name, {
      dbPath: db.dbPath,
      folder: TOOLS_FOLDER,
      now: NOW,
      ...opts,
    });
  }

  it("lists the most recent errors first, capped at the limit", async () => {
    // Edit errored at 09:01 and 09:02; its 09:03 call succeeded.
    const samples = await samplesFor("Edit");

    expect(samples.recentErrors.map((c) => c.toolUseId)).toEqual([
      "tt-edit-2",
      "tt-edit-1",
    ]);
    expect(samples.recentErrors.every((c) => c.isError)).toBe(true);

    const capped = await samplesFor("Edit", { limit: 1 });
    expect(capped.recentErrors.map((c) => c.toolUseId)).toEqual(["tt-edit-2"]);
  });

  it("lists the largest results first, capped at the limit", async () => {
    // Edit result sizes: 3, 4, 5 — biggest first, errors included.
    const samples = await samplesFor("Edit");
    expect(samples.largestResults.map((c) => c.charSize)).toEqual([5, 4, 3]);

    const capped = await samplesFor("Edit", { limit: 2 });
    expect(capped.largestResults.map((c) => c.charSize)).toEqual([5, 4]);
  });

  it("carries what a transcript deep-link needs on every sample", async () => {
    const samples = await samplesFor("Edit");
    const [first] = samples.largestResults;

    expect(first?.sessionId).toBe("sess-toolstats");
    expect(first?.agentId).not.toBe("");
    expect(first?.toolUseId).toBe("tt-edit-3");
    expect(first?.timestamp).toBe("2026-06-20T09:03:00.000Z");
    expect(first?.inputJson).toContain("/src/f3.ts");
  });

  it("samples sub-agent calls too, naming the sub-agent to link into", async () => {
    // The 100-char Bash result ran inside the Explore sub-agent.
    const samples = await samplesFor("Bash");
    const [biggest] = samples.largestResults;

    expect(biggest?.charSize).toBe(100);
    expect(biggest?.agentId).toBe("tsub1");
  });

  it("breaks Skill calls down by skill name, with calls and errors", async () => {
    // `commit` errored, `tdd` did not.
    const samples = await samplesFor("Skill");

    expect(samples.breakdown).toEqual([
      { key: "commit", calls: 1, errors: 1 },
      { key: "tdd", calls: 1, errors: 0 },
    ]);
  });

  it("breaks Agent calls down by sub-agent type", async () => {
    const samples = await samplesFor("Agent");
    expect(samples.breakdown).toEqual([{ key: "Explore", calls: 1, errors: 0 }]);
  });

  it("has no breakdown for an ordinary tool", async () => {
    const samples = await samplesFor("Bash");
    expect(samples.breakdown).toEqual([]);
  });

  it("returns empty lists for a tool with no calls in scope", async () => {
    const samples = await getToolCallSamples("Bash", {
      dbPath: db.dbPath,
      folder: TOOLS_FOLDER,
      days: 7,
      now: Date.parse("2026-07-20T12:00:00.000Z"),
    });

    expect(samples.recentErrors).toEqual([]);
    expect(samples.largestResults).toEqual([]);
  });
});
