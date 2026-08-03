import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getDailySpend } from "@/core/read";
import { refresh } from "@/core/refresh";

const FIXTURES_ROOT = path.join(import.meta.dirname, "fixtures", "logs");

/** The Project the daily-spend fixture lives in (the `?folder=` scope key). */
const TRENDS_FOLDER = "-Users-me-dev-trends";

/**
 * The local calendar day of an instant, derived here with plain `Date` accessors
 * rather than hardcoded date strings, so the expectations hold on a machine in
 * ANY timezone (including UTC+13, where a 12:00Z fixture instant falls on the
 * next local day).
 */
function localDay(iso: string): string {
  const d = new Date(iso);
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${month}-${day}`;
}

/** The fixture's two active instants and the untouched day between them. */
const DAY_ONE = "2026-06-10T12:00:05.000Z";
const DAY_GAP = "2026-06-11T12:00:00.000Z";
const DAY_TWO = "2026-06-12T12:00:00.000Z";
/** "Now" for every read — comfortably after all fixture activity. */
const NOW = Date.parse("2026-07-01T12:00:00.000Z");

describe("getDailySpend", () => {
  let tmpDir: string;
  let dbPath: string;

  beforeEach(async () => {
    tmpDir = mkdtempSync(path.join(tmpdir(), "cca-daily-"));
    dbPath = path.join(tmpDir, "analyzer.db");
    await refresh({ logsRoot: FIXTURES_ROOT, dbPath });
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("buckets cost by local day and zero-fills days with no activity", async () => {
    const spend = await getDailySpend({
      dbPath,
      folder: TRENDS_FOLDER,
      now: NOW,
    });

    const byDate = new Map(spend.days.map((d) => [d.date, d]));
    expect(byDate.get(localDay(DAY_ONE))?.costUsd).toBeGreaterThan(0);
    expect(byDate.get(localDay(DAY_TWO))?.costUsd).toBeGreaterThan(0);

    // The untouched day between them is present and zero — a gap, not a hole.
    const gap = byDate.get(localDay(DAY_GAP));
    expect(gap).toBeDefined();
    expect(gap?.costUsd).toBe(0);
    expect(gap?.tokens.total).toBe(0);
    expect(gap?.perModel).toEqual([]);
  });

  it("returns exactly `days` days ending today, excluding older activity", async () => {
    const spend = await getDailySpend({
      dbPath,
      folder: TRENDS_FOLDER,
      days: 7,
      now: NOW,
    });

    expect(spend.days).toHaveLength(7);
    expect(spend.days.at(-1)?.date).toBe(localDay(new Date(NOW).toISOString()));
    // All fixture activity predates this window: 7 zero-filled days, no bands.
    expect(spend.days.every((d) => d.costUsd === 0)).toBe(true);
    expect(spend.models).toEqual([]);
    expect(spend.totalCostUsd).toBe(0);
    expect(spend.totalTokens.total).toBe(0);
    expect(spend.hasUnpriced).toBe(false);
    expect(spend.hasApproximate).toBe(false);
  });

  it("spans from the earliest in-scope message day to today when no range is given", async () => {
    const spend = await getDailySpend({
      dbPath,
      folder: TRENDS_FOLDER,
      now: NOW,
    });

    expect(spend.days[0]?.date).toBe(localDay(DAY_ONE));
    expect(spend.days.at(-1)?.date).toBe(localDay(new Date(NOW).toISOString()));
    // Contiguous: one day per step, ascending, no repeats.
    const dates = spend.days.map((d) => d.date);
    expect([...dates].sort()).toEqual(dates);
    expect(new Set(dates).size).toBe(dates.length);
  });

  it("prices each day's models per tier, 5m and 1h cache writes apart", async () => {
    const spend = await getDailySpend({
      dbPath,
      folder: TRENDS_FOLDER,
      now: NOW,
    });

    const dayOne = spend.days.find((d) => d.date === localDay(DAY_ONE));
    // opus-4-8: 100 in, 50 out, 200 cache-write 5m, 100 cache-write 1h, 20 read.
    // Priced apart the two write tiers cost 200*6.25 + 100*10 per MTok; merged
    // at the 5m tier they would cost 300*6.25 — so this number pins the split.
    const opus = dayOne?.perModel.find((m) => m.model === "claude-opus-4-8");
    expect(opus?.costUsd).toBeCloseTo(
      (100 * 5 + 50 * 25 + 200 * 6.25 + 100 * 10 + 20 * 0.5) / 1_000_000,
      12,
    );
    expect(dayOne?.tokens.total).toBe(100 + 50 + 300 + 20 + 10 + 20);
  });

  it("includes sub-agent usage as a band of the day it ran on", async () => {
    const spend = await getDailySpend({
      dbPath,
      folder: TRENDS_FOLDER,
      now: NOW,
    });

    const dayTwo = spend.days.find((d) => d.date === localDay(DAY_TWO));
    // The haiku band comes ONLY from the sub-agent transcript (the main thread
    // never ran haiku), and lands on the sub-agent turn's own day.
    const haiku = dayTwo?.perModel.find(
      (m) => m.model === "claude-haiku-4-5-20251001",
    );
    expect(haiku?.costUsd).toBeCloseTo(
      (50 * 1 + 130 * 5 + 20 * 0.1) / 1_000_000,
      12,
    );
    // Bands are ordered by cost, descending: sonnet ($0.00102) over haiku.
    expect(dayTwo?.perModel.map((m) => m.model)).toEqual([
      "claude-sonnet-4-6",
      "claude-haiku-4-5-20251001",
    ]);
  });

  it("ranks the range's priced models by cost — the stack and legend order", async () => {
    const spend = await getDailySpend({
      dbPath,
      folder: TRENDS_FOLDER,
      now: NOW,
    });

    expect(spend.models.map((m) => m.model)).toEqual([
      "claude-opus-4-8",
      "claude-sonnet-4-6",
      "claude-haiku-4-5-20251001",
      "opus",
    ]);
    // Each day's cost sums to the range total, which sums the model totals.
    const summedDays = spend.days.reduce((sum, d) => sum + d.costUsd, 0);
    const summedModels = spend.models.reduce((sum, m) => sum + m.costUsd, 0);
    expect(summedDays).toBeCloseTo(spend.totalCostUsd, 12);
    expect(summedModels).toBeCloseTo(spend.totalCostUsd, 12);
  });

  it("gives unpriced usage $0 and no band, but keeps its tokens and flags it", async () => {
    const spend = await getDailySpend({
      dbPath,
      folder: TRENDS_FOLDER,
      now: NOW,
    });

    const dayTwo = spend.days.find((d) => d.date === localDay(DAY_TWO));
    // The `<synthetic>` turn (7 in + 9 out) gets no band anywhere...
    expect(dayTwo?.perModel.map((m) => m.model)).not.toContain("<synthetic>");
    expect(spend.models.map((m) => m.model)).not.toContain("<synthetic>");
    // ...but its tokens still count: sonnet 100 + haiku 200 + synthetic 16.
    expect(dayTwo?.tokens.total).toBe(100 + 200 + 16);
    expect(spend.hasUnpriced).toBe(true);
    // The bare-alias `opus` turn IS priced, at the family-latest rate, and flagged.
    expect(spend.hasApproximate).toBe(true);
  });

  it("excludes a message with no timestamp and one with no model", async () => {
    const spend = await getDailySpend({
      dbPath,
      folder: TRENDS_FOLDER,
      now: NOW,
    });

    // The fixture's two outliers carry 1000+1000 and 500+500 tokens; neither can
    // be bucketed (no timestamp) or priced (no model), so neither is counted.
    expect(spend.totalTokens.total).toBe(470 + 30 + 100 + 200 + 16);
  });

  it("scopes to one Project, or spans all Projects when unscoped", async () => {
    const scoped = await getDailySpend({
      dbPath,
      folder: TRENDS_FOLDER,
      now: NOW,
    });
    const all = await getDailySpend({ dbPath, now: NOW });
    const other = await getDailySpend({
      dbPath,
      folder: "-Users-me-dev-demo",
      now: NOW,
    });

    expect(all.totalTokens.total).toBeGreaterThan(scoped.totalTokens.total);
    expect(all.totalCostUsd).toBeGreaterThan(scoped.totalCostUsd);
    // Another Project's range carries none of this Project's usage.
    expect(other.totalTokens.total).toBeGreaterThan(0);
    expect(all.totalTokens.total).toBeGreaterThanOrEqual(
      scoped.totalTokens.total + other.totalTokens.total,
    );
    // ...and its all-time range starts at its OWN earliest day, later than this
    // Project's first day — that day is out of the other Project's range entirely.
    expect(other.days[0]?.date).toBeDefined();
    // `YYYY-MM-DD` keys sort lexically in chronological order.
    expect((other.days[0]?.date ?? "") > localDay(DAY_ONE)).toBe(true);
  });
});
