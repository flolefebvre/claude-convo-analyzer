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
    expect((await countsById()).get("sess-err-sub")).toBe(1);
  });

  it("reports zero for a conversation with no failed turn", async () => {
    expect((await countsById()).get("sess-err-clean")).toBe(0);
  });
});
