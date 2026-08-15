import path from "node:path";
import { describe, expect, it } from "vitest";

import { getDailySpend } from "@/core/read";

import { seededTempDb } from "./helpers/temp-db";

const FIXTURES_ROOT = path.join(import.meta.dirname, "fixtures", "logs");

const TRENDS_FOLDER = "-Users-me-dev-trends";

function localDay(iso: string): string {
  const d = new Date(iso);
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${month}-${day}`;
}

const DAY_ONE = "2026-06-10T12:00:05.000Z";
const DAY_GAP = "2026-06-11T12:00:00.000Z";
const DAY_TWO = "2026-06-12T12:00:00.000Z";
const NOW = Date.parse("2026-07-01T12:00:00.000Z");

describe("getDailySpend", () => {
  const db = seededTempDb({ prefix: "cca-daily-", logsRoot: FIXTURES_ROOT });

  function trendsSpend() {
    return getDailySpend({ dbPath: db.dbPath, folder: TRENDS_FOLDER, now: NOW });
  }

  it("buckets cost by local day and zero-fills days with no activity", async () => {
    const spend = await trendsSpend();

    const byDate = new Map(spend.days.map((d) => [d.date, d]));
    expect(byDate.get(localDay(DAY_ONE))?.costUsd).toBeGreaterThan(0);
    expect(byDate.get(localDay(DAY_TWO))?.costUsd).toBeGreaterThan(0);

    const gap = byDate.get(localDay(DAY_GAP));
    expect(gap).toBeDefined();
    expect(gap?.costUsd).toBe(0);
    expect(gap?.tokens.total).toBe(0);
    expect(gap?.perModel).toEqual([]);
  });

  it("returns exactly `days` days ending today, excluding older activity", async () => {
    const spend = await getDailySpend({
      dbPath: db.dbPath,
      folder: TRENDS_FOLDER,
      days: 7,
      now: NOW,
    });

    expect(spend.days).toHaveLength(7);
    expect(spend.days.at(-1)?.date).toBe(localDay(new Date(NOW).toISOString()));
    expect(spend.days.every((d) => d.costUsd === 0)).toBe(true);
    expect(spend.models).toEqual([]);
    expect(spend.totalCostUsd).toBe(0);
    expect(spend.totalTokens.total).toBe(0);
    expect(spend.hasUnpriced).toBe(false);
    expect(spend.hasApproximate).toBe(false);
  });

  it("spans from the earliest in-scope message day to today when no range is given", async () => {
    const spend = await trendsSpend();

    expect(spend.days[0]?.date).toBe(localDay(DAY_ONE));
    expect(spend.days.at(-1)?.date).toBe(localDay(new Date(NOW).toISOString()));
    const dates = spend.days.map((d) => d.date);
    expect([...dates].sort()).toEqual(dates);
    expect(new Set(dates).size).toBe(dates.length);
  });

  it("prices each day's models per tier, 5m and 1h cache writes apart", async () => {
    const spend = await trendsSpend();

    const dayOne = spend.days.find((d) => d.date === localDay(DAY_ONE));
    const opus = dayOne?.perModel.find((m) => m.model === "claude-opus-4-8");
    expect(opus?.costUsd).toBeCloseTo((100 * 5 + 50 * 25 + 200 * 6.25 + 100 * 10 + 20 * 0.5) / 1_000_000, 12);
    expect(dayOne?.tokens.total).toBe(100 + 50 + 300 + 20 + 10 + 20);
  });

  it("includes sub-agent usage as a band of the day it ran on", async () => {
    const spend = await trendsSpend();

    const dayTwo = spend.days.find((d) => d.date === localDay(DAY_TWO));
    const haiku = dayTwo?.perModel.find((m) => m.model === "claude-haiku-4-5-20251001");
    expect(haiku?.costUsd).toBeCloseTo((50 * 1 + 130 * 5 + 20 * 0.1) / 1_000_000, 12);
    expect(dayTwo?.perModel.map((m) => m.model)).toEqual(["claude-sonnet-4-6", "claude-haiku-4-5-20251001"]);
  });

  it("ranks the range's priced models by cost — the stack and legend order", async () => {
    const spend = await trendsSpend();

    expect(spend.models.map((m) => m.model)).toEqual([
      "claude-opus-4-8",
      "claude-sonnet-4-6",
      "claude-haiku-4-5-20251001",
      "opus",
    ]);
    const summedDays = spend.days.reduce((sum, d) => sum + d.costUsd, 0);
    const summedModels = spend.models.reduce((sum, m) => sum + m.costUsd, 0);
    expect(summedDays).toBeCloseTo(spend.totalCostUsd, 12);
    expect(summedModels).toBeCloseTo(spend.totalCostUsd, 12);
  });

  it("gives unpriced usage $0 and no band, but keeps its tokens and flags it", async () => {
    const spend = await trendsSpend();

    const dayTwo = spend.days.find((d) => d.date === localDay(DAY_TWO));
    expect(dayTwo?.perModel.map((m) => m.model)).not.toContain("<synthetic>");
    expect(spend.models.map((m) => m.model)).not.toContain("<synthetic>");
    expect(dayTwo?.tokens.total).toBe(100 + 200 + 16);
    expect(spend.hasUnpriced).toBe(true);
    expect(spend.hasApproximate).toBe(true);
  });

  it("excludes a message with no timestamp and one with no model", async () => {
    const spend = await trendsSpend();

    expect(spend.totalTokens.total).toBe(470 + 30 + 100 + 200 + 16);
  });

  it("scopes to one Project, or spans all Projects when unscoped", async () => {
    const scoped = await trendsSpend();
    const all = await getDailySpend({ dbPath: db.dbPath, now: NOW });
    const other = await getDailySpend({
      dbPath: db.dbPath,
      folder: "-Users-me-dev-demo",
      now: NOW,
    });

    expect(all.totalTokens.total).toBeGreaterThan(scoped.totalTokens.total);
    expect(all.totalCostUsd).toBeGreaterThan(scoped.totalCostUsd);
    expect(other.totalTokens.total).toBeGreaterThan(0);
    expect(all.totalTokens.total).toBeGreaterThanOrEqual(scoped.totalTokens.total + other.totalTokens.total);
    expect(other.days[0]?.date).toBeDefined();
    expect((other.days[0]?.date ?? "") > localDay(DAY_ONE)).toBe(true);
  });
});
