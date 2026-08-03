// API-error rollup (issue #47): how many turns of a Conversation the API failed
// on — counted across ALL of its agents, so a sub-agent failure is as visible on
// the list row as a main-thread one (the same ADR-0001 rollup rule as tokens).
//
// Like the family suite these fixtures live in their OWN logs root
// (`fixtures/error-logs`): the shared corpus carries exact assertions on its
// conversation set, and error-bearing sessions belong to this behavior only. The
// root encodes a main thread with two failed turns, a session whose only failure
// is inside a sub-agent, and a clean session.

import path from "node:path";
import { describe, expect, it } from "vitest";

import { listConversations } from "@/core/read";

import { seededTempDb } from "./helpers/temp-db";

const FIXTURES_ROOT = path.join(import.meta.dirname, "fixtures", "error-logs");

describe("listConversations errorCount", () => {
  const db = seededTempDb({ prefix: "cca-errors-", logsRoot: FIXTURES_ROOT });

  async function countsById(): Promise<Map<string, number>> {
    const rows = await listConversations({ dbPath: db.dbPath });
    return new Map(rows.map((r) => [r.id, r.errorCount]));
  }

  it("counts every failed turn of the main thread", async () => {
    expect((await countsById()).get("sess-err-main")).toBe(2);
  });

  it("counts a sub-agent's failed turns on the conversation (ADR-0001 rollup)", async () => {
    // The main thread of this session never failed — the only failure is inside
    // the Explore sub-agent, and it still surfaces on the conversation row.
    expect((await countsById()).get("sess-err-sub")).toBe(1);
  });

  it("reports zero for a conversation with no failed turn", async () => {
    expect((await countsById()).get("sess-err-clean")).toBe(0);
  });
});
