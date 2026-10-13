import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { PAGE_SIZE } from "@/app/_lib/list-view";
import { listConversations } from "@/core/read";

import { seedEnvironment } from "./environment";

const NOW = new Date("2026-06-22T17:00:00.000Z");

// A full seed is a real ingest of 133 files (~3s); two per test outrun the 5s
// default when the suite runs in parallel.
describe("seedEnvironment", { timeout: 30_000 }, () => {
  let tmpDir = "";

  beforeEach(() => {
    tmpDir = mkdtempSync(path.join(tmpdir(), "cca-seed-test-"));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("ingests every seeded Conversation, sub-agent and continuation family without a malformed line", async () => {
    const seed = await seedEnvironment({ dir: path.join(tmpDir, "seed"), now: NOW });

    expect(seed.summary.malformedLinesSkipped).toBe(0);
    expect(seed.summary.duplicateSessionsSkipped).toEqual([]);

    const conversations = await listConversations({ dbPath: seed.dbPath });
    expect(conversations).toHaveLength(60);
    expect(conversations.reduce((sum, c) => sum + c.subAgentCount, 0)).toBe(73);

    const continued = conversations.filter((c) => c.continuedFromId !== null);
    expect(continued).toHaveLength(5);
    const familyRoots = conversations.filter(
      (c) => c.continuedFromId === null && continued.some((d) => d.continuedFromId === c.id),
    );
    expect(familyRoots).toHaveLength(2);
  });

  it("seeds a second page of Conversations, one with unpriced usage and another with API errors", async () => {
    const seed = await seedEnvironment({ dir: path.join(tmpDir, "seed"), now: NOW });

    const conversations = await listConversations({ dbPath: seed.dbPath });
    expect(conversations.length).toBeGreaterThan(PAGE_SIZE);

    const unpriced = conversations.find((c) => c.title === "Investigate a model the price table does not know");
    expect(unpriced).toMatchObject({ unpriced: true, errorCount: 0 });
    expect(unpriced?.costUsd).toBeGreaterThan(0);

    const failing = conversations.find((c) => c.title === "Finish the release while the API keeps failing");
    expect(failing).toMatchObject({ unpriced: false });
    expect(failing?.errorCount).toBeGreaterThan(0);
  });

  it("ends the seeded activity at the anchor", async () => {
    const seed = await seedEnvironment({ dir: path.join(tmpDir, "seed"), now: NOW });

    const conversations = await listConversations({ dbPath: seed.dbPath });
    const latest = conversations
      .map((c) => c.endedAt)
      .sort()
      .at(-1);
    expect(latest).toBe(NOW.toISOString());
  });

  it("writes byte-identical logs for the same anchor", async () => {
    const first = await seedEnvironment({ dir: path.join(tmpDir, "first"), now: NOW });
    const second = await seedEnvironment({ dir: path.join(tmpDir, "second"), now: NOW });

    const files = readTree(first.logsRoot);
    expect(Object.keys(files)).toHaveLength(first.generated.conversations + first.generated.subAgents);
    expect(readTree(second.logsRoot)).toEqual(files);
  });

  it("rebuilds from a clean slate, leaving nothing from a previous run", async () => {
    const dir = path.join(tmpDir, "seed");
    const before = await seedEnvironment({ dir, now: NOW });
    const leftover = path.join(before.logsRoot, "-home-dev-stale", "stale-session.jsonl");
    mkdirSync(path.dirname(leftover), { recursive: true });
    writeFileSync(leftover, "{}\n");

    const after = await seedEnvironment({ dir, now: NOW });

    expect(existsSync(leftover)).toBe(false);
    expect(await listConversations({ dbPath: after.dbPath })).toHaveLength(60);
  });
});

/** Every file under `root`, by relative path, with its contents. */
function readTree(root: string): Record<string, string> {
  const files = readdirSync(root, { recursive: true, withFileTypes: true }).filter((e) => e.isFile());
  return Object.fromEntries(
    files.map((e) => {
      const file = path.join(e.parentPath, e.name);
      return [path.relative(root, file), readFileSync(file, "utf8")];
    }),
  );
}
