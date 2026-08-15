import path from "node:path";
import { describe, expect, it } from "vitest";
import { searchConversations } from "@/core/search";

import { seededTempDb } from "./helpers/temp-db";

const FIXTURES_ROOT = path.join(import.meta.dirname, "fixtures", "logs");

function snippetText(segments: { text: string }[]): string {
  return segments.map((s) => s.text).join("");
}

describe("searchConversations", () => {
  const db = seededTempDb({ prefix: "cca-search-", logsRoot: FIXTURES_ROOT });

  it("groups matches into one result per conversation", async () => {
    const { results } = await searchConversations("postgres", {
      dbPath: db.dbPath,
    });

    const sessions = results.map((r) => r.sessionId);
    expect(sessions).toContain("sess-search-a");
    expect(sessions).toContain("sess-search-b");
    expect(new Set(sessions).size).toBe(sessions.length);

    const a = results.find((r) => r.sessionId === "sess-search-a");
    expect(a).toBeDefined();
    if (!a) return;
    expect(a.title).toBe("Postgres migration plan");
    expect(a.project.folder).toBe("-Users-me-dev-search");
    expect(a.project.path).toBe("/Users/me/dev/search");
    expect(a.lastMatchAt).toBe("2026-06-25T09:01:00.000Z");
  });

  it("counts every matching message, plus the title, as matches", async () => {
    const { results } = await searchConversations("postgres", {
      dbPath: db.dbPath,
    });
    const a = results.find((r) => r.sessionId === "sess-search-a");
    expect(a?.matchCount).toBe(5);
  });

  it("orders conversations by the recency of their last matching message", async () => {
    const { results } = await searchConversations("postgres", {
      dbPath: db.dbPath,
    });
    const ours = results.map((r) => r.sessionId).filter((s) => s.startsWith("sess-search-"));
    expect(ours).toEqual(["sess-search-b", "sess-search-a", "sess-search-c"]);
  });

  it("returns at most three snippets, with the matched terms marked", async () => {
    const { results } = await searchConversations("postgres", {
      dbPath: db.dbPath,
    });
    const a = results.find((r) => r.sessionId === "sess-search-a");
    expect(a).toBeDefined();
    if (!a) return;

    expect(a.snippets.length).toBeLessThanOrEqual(3);
    expect(a.snippets.length).toBeGreaterThan(0);
    for (const snippet of a.snippets) {
      const marked = snippet.segments.filter((s) => s.match);
      expect(marked.length).toBeGreaterThan(0);
      for (const m of marked) {
        expect(m.text.toLowerCase()).toContain("postgres");
      }
      expect(snippetText(snippet.segments).toLowerCase()).toContain("postgres");
    }
  });

  it("anchors a message snippet on the message uuid and its agent", async () => {
    const { results } = await searchConversations("write-ahead", {
      dbPath: db.dbPath,
    });
    const a = results.find((r) => r.sessionId === "sess-search-a");
    expect(a).toBeDefined();
    if (!a) return;

    const snippet = a.snippets[0];
    expect(snippet.source).toBe("message");
    expect(snippet.messageUuid).toBe("qsa1");
    expect(snippet.agentId).toBe("s1");
  });

  it("matches a conversation on its title alone, linking to the conversation", async () => {
    const { results } = await searchConversations("tuning", {
      dbPath: db.dbPath,
    });
    expect(results.map((r) => r.sessionId)).toEqual(["sess-search-c"]);

    const c = results[0];
    expect(c.matchCount).toBe(1);
    expect(c.snippets).toHaveLength(1);
    expect(c.snippets[0].source).toBe("title");
    expect(c.snippets[0].messageUuid).toBeNull();
    expect(c.snippets[0].agentId).toBeNull();
    expect(snippetText(c.snippets[0].segments)).toContain("tuning");
  });

  it("never matches meta records, tool-result carriers, or tool text", async () => {
    const carrier = await searchConversations("carrier", { dbPath: db.dbPath });
    expect(carrier.results).toEqual([]);

    const meta = await searchConversations("reminder", { dbPath: db.dbPath });
    expect(meta.results).toEqual([]);

    const searchable = await searchConversations("inspect", {
      dbPath: db.dbPath,
    });
    const uuids = searchable.results.flatMap((r) => r.snippets).map((s) => s.messageUuid);
    expect(uuids).not.toContain("qa1");
  });

  it("narrows as terms are added (AND semantics)", async () => {
    const broad = await searchConversations("cache", { dbPath: db.dbPath });
    expect(broad.results.map((r) => r.sessionId)).toContain("sess-search-b");

    const narrow = await searchConversations("cache postgres failover", {
      dbPath: db.dbPath,
    });
    expect(narrow.results.map((r) => r.sessionId)).toEqual(["sess-search-a"]);
  });

  it("supports quoted phrases", async () => {
    const phrase = await searchConversations('"cache invalidation"', {
      dbPath: db.dbPath,
    });
    expect(phrase.results.map((r) => r.sessionId)).toEqual(["sess-search-a"]);
  });

  it("caps the result list and reports that more matched", async () => {
    const capped = await searchConversations("postgres", {
      dbPath: db.dbPath,
      limit: 1,
    });
    expect(capped.results).toHaveLength(1);
    expect(capped.hasMore).toBe(true);

    const full = await searchConversations("postgres", { dbPath: db.dbPath });
    expect(full.hasMore).toBe(false);
  });

  it("returns nothing for a query with no searchable terms", async () => {
    for (const raw of ["", "   ", "***", "-- ??"]) {
      const empty = await searchConversations(raw, { dbPath: db.dbPath });
      expect(empty.results).toEqual([]);
      expect(empty.hasMore).toBe(false);
    }
  });

  it("degrades hostile FTS5 syntax to a literal search instead of erroring", async () => {
    const hostile = [
      "NEAR(postgres failover)",
      "postgres*",
      'unbalanced "quote postgres',
      "postgres OR NOT (",
      "^postgres",
      "postgres AND",
      '""',
      "postgres:failover",
    ];
    for (const raw of hostile) {
      const out = await searchConversations(raw, { dbPath: db.dbPath });
      expect(Array.isArray(out.results)).toBe(true);
    }

    const starred = await searchConversations("postgres*", {
      dbPath: db.dbPath,
    });
    expect(starred.results.map((r) => r.sessionId)).toContain("sess-search-a");
  });
});
