import { describe, expect, it } from "vitest";

import type { ConversationSummary } from "@/core/refresh";

import { deriveFolders, type FolderEntry } from "@/app/_lib/folders";
import { deriveOverview, topProjectsByCost } from "@/app/_lib/overview";

// Minimal ConversationSummary factory — each test sets only what it asserts on.
function summary(over: {
  id: string;
  folder?: string;
  path?: string;
  startedAt?: string;
  endedAt?: string;
  costUsd?: number;
  cacheRead?: number;
  total?: number;
  unpriced?: boolean;
}): ConversationSummary {
  const path = over.path ?? "/Users/me/dev/demo";
  const folder = over.folder ?? path.replace(/\//g, "-");
  const total = over.total ?? 0;
  return {
    id: over.id,
    title: `t-${over.id}`,
    project: { folder, path },
    startedAt: over.startedAt ?? "2026-01-01T00:00:00.000Z",
    endedAt: over.endedAt ?? "2026-01-01T01:00:00.000Z",
    models: { dominant: "opus", distinctCount: 1 },
    tokens: {
      input: 0,
      output: 0,
      cacheWrite: 0,
      cacheRead: over.cacheRead ?? 0,
      total,
    },
    costUsd: over.costUsd ?? 0,
    unpriced: over.unpriced ?? false,
    subAgentCount: 0,
    continuedFromId: null,
  };
}

describe("deriveOverview", () => {
  it("counts conversations and distinct Projects", () => {
    const o = deriveOverview([
      summary({ id: "a", folder: "fA" }),
      summary({ id: "b", folder: "fA" }),
      summary({ id: "c", folder: "fB" }),
    ]);
    expect(o.conversationCount).toBe(3);
    expect(o.projectCount).toBe(2);
  });

  it("sums cost and total tokens, flagging hasUnpriced if any row is unpriced", () => {
    const o = deriveOverview([
      summary({ id: "a", costUsd: 10, total: 100 }),
      summary({ id: "b", costUsd: 5, total: 50, unpriced: true }),
    ]);
    expect(o.totalCost).toBeCloseTo(15);
    expect(o.tokens.total).toBe(150);
    expect(o.hasUnpriced).toBe(true);
  });

  it("computes the cache-read ratio as cacheRead / total tokens", () => {
    const o = deriveOverview([
      summary({ id: "a", total: 100, cacheRead: 60 }),
      summary({ id: "b", total: 100, cacheRead: 20 }),
    ]);
    // 80 cache-read of 200 total -> 0.4
    expect(o.cacheReadRatio).toBeCloseTo(0.4);
  });

  it("returns a zero cache-read ratio when there are no tokens (no divide by zero)", () => {
    const o = deriveOverview([summary({ id: "a", total: 0, cacheRead: 0 })]);
    expect(o.cacheReadRatio).toBe(0);
  });

  it("reports the earliest start and the latest activity across all rows", () => {
    const o = deriveOverview([
      summary({
        id: "a",
        startedAt: "2026-03-01T00:00:00.000Z",
        endedAt: "2026-03-02T00:00:00.000Z",
      }),
      summary({
        id: "b",
        startedAt: "2026-01-15T00:00:00.000Z",
        endedAt: "2026-01-16T00:00:00.000Z",
      }),
    ]);
    expect(o.earliest).toBe("2026-01-15T00:00:00.000Z");
    expect(o.latest).toBe("2026-03-02T00:00:00.000Z");
  });

  it("ignores empty timestamps in the date range, falling back to startedAt for latest", () => {
    const o = deriveOverview([
      summary({
        id: "a",
        startedAt: "2026-05-01T00:00:00.000Z",
        endedAt: "",
      }),
      summary({ id: "b", startedAt: "", endedAt: "" }),
    ]);
    expect(o.earliest).toBe("2026-05-01T00:00:00.000Z");
    expect(o.latest).toBe("2026-05-01T00:00:00.000Z");
  });

  it("yields empty range and zeroed totals for no conversations", () => {
    const o = deriveOverview([]);
    expect(o.conversationCount).toBe(0);
    expect(o.projectCount).toBe(0);
    expect(o.totalCost).toBe(0);
    expect(o.tokens.total).toBe(0);
    expect(o.hasUnpriced).toBe(false);
    expect(o.cacheReadRatio).toBe(0);
    expect(o.earliest).toBe("");
    expect(o.latest).toBe("");
  });
});

describe("topProjectsByCost", () => {
  function folders(): FolderEntry[] {
    return deriveFolders([
      summary({ id: "a", folder: "fA", path: "/p/alpha", costUsd: 5 }),
      summary({ id: "b", folder: "fB", path: "/p/beta", costUsd: 30 }),
      summary({ id: "c", folder: "fC", path: "/p/gamma", costUsd: 12 }),
    ]);
  }

  it("orders Projects by cost descending", () => {
    expect(topProjectsByCost(folders(), 3).map((e) => e.label)).toEqual([
      "beta",
      "gamma",
      "alpha",
    ]);
  });

  it("limits to the requested number of Projects", () => {
    const top = topProjectsByCost(folders(), 2);
    expect(top.map((e) => e.label)).toEqual(["beta", "gamma"]);
  });

  it("does not mutate the input array order", () => {
    const input = folders();
    const before = input.map((e) => e.folder);
    topProjectsByCost(input, 2);
    expect(input.map((e) => e.folder)).toEqual(before);
  });
});
