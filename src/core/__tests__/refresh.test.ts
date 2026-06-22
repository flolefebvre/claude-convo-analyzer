import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { listConversations } from "@/core/read";
import { refresh } from "@/core/refresh";

const FIXTURES_ROOT = path.join(import.meta.dirname, "fixtures", "logs");

describe("core ingest spine", () => {
  let tmpDir: string;
  let dbPath: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(path.join(tmpdir(), "cca-refresh-"));
    dbPath = path.join(tmpDir, "analyzer.db");
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("parses a basic conversation with assistant and user turns and a title", async () => {
    const summary = await refresh({ logsRoot: FIXTURES_ROOT, dbPath });

    expect(summary.conversationsParsed).toBeGreaterThanOrEqual(1);
    expect(summary.conversationsSkipped).toBe(0);
    expect(summary.conversationsDeleted).toBe(0);
    expect(typeof summary.durationMs).toBe("number");

    const convos = await listConversations({ dbPath });
    const basic = convos.find((c) => c.id === "sess-basic");
    expect(basic).toBeDefined();
    if (!basic) return;

    expect(basic.title).toBe("Refactor the parser");
    expect(basic.project.folder).toBe("-Users-me-dev-demo");
    expect(basic.project.path).toBe("/Users/me/dev/demo");

    // dominant = model with most OUTPUT tokens → sonnet (500 > 50)
    expect(basic.models.dominant).toBe("claude-sonnet-4-6");
    expect(basic.models.distinctCount).toBe(2);

    // token rollup across both assistant turns (cacheWrite = 5m + 1h merged)
    expect(basic.tokens.input).toBe(110);
    expect(basic.tokens.output).toBe(550);
    expect(basic.tokens.cacheWrite).toBe(300);
    expect(basic.tokens.cacheRead).toBe(20);
    expect(basic.tokens.total).toBe(110 + 550 + 300 + 20);

    expect(basic.unpriced).toBe(false);
    expect(basic.costUsd).toBeGreaterThan(0);
    expect(basic.subAgentCount).toBe(0);
    expect(basic.continuedFromId).toBeNull();

    expect(basic.startedAt).toBe("2026-06-20T10:00:00.000Z");
    expect(basic.endedAt).toBe("2026-06-20T10:01:00.000Z");
  });

  it("deduplicates assistant turns by message id, counting usage once", async () => {
    await refresh({ logsRoot: FIXTURES_ROOT, dbPath });
    const convos = await listConversations({ dbPath });
    const dup = convos.find((c) => c.id === "sess-dup");
    expect(dup).toBeDefined();
    if (!dup) return;

    // Three records repeat the identical usage for one message.id → count once.
    expect(dup.tokens.input).toBe(1000);
    expect(dup.tokens.output).toBe(40);
    expect(dup.models.distinctCount).toBe(1);
  });

  it("extracts message text when content is a plain string", async () => {
    await refresh({ logsRoot: FIXTURES_ROOT, dbPath });
    const convos = await listConversations({ dbPath });
    const str = convos.find((c) => c.id === "sess-stringcontent");
    expect(str).toBeDefined();
    if (!str) return;

    // No title record → falls back to first user prompt, whose content is a
    // plain string. A non-null title proves string-form text was extracted.
    expect(str.title).toBe("a plain string prompt");
  });

  it("flags a conversation as unpriced when a synthetic model contributes tokens", async () => {
    await refresh({ logsRoot: FIXTURES_ROOT, dbPath });
    const convos = await listConversations({ dbPath });
    const synth = convos.find((c) => c.id === "sess-synth");
    expect(synth).toBeDefined();
    if (!synth) return;

    expect(synth.unpriced).toBe(true);
    expect(synth.costUsd).toBe(0);
    expect(synth.project.folder).toBe("-Users-me-dev-synth");
  });

  it("skips and counts a malformed JSONL line without failing the parse", async () => {
    const summary = await refresh({ logsRoot: FIXTURES_ROOT, dbPath });
    expect(summary.malformedLinesSkipped).toBeGreaterThanOrEqual(1);

    const convos = await listConversations({ dbPath });
    const mal = convos.find((c) => c.id === "sess-malformed");
    expect(mal).toBeDefined();
    if (!mal) return;

    // The good lines around the garbage line still parsed.
    expect(mal.title).toBe("Has a bad line");
    expect(mal.tokens.output).toBe(4);
  });

  it("sorts conversations by a summary field in the requested direction", async () => {
    await refresh({ logsRoot: FIXTURES_ROOT, dbPath });
    const desc = await listConversations({ dbPath, sortBy: "costUsd", dir: "desc" });
    const costs = desc.map((c) => c.costUsd);
    const sorted = [...costs].sort((a, b) => b - a);
    expect(costs).toEqual(sorted);
  });
});
