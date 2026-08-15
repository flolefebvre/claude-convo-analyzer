import path from "node:path";
import { describe, expect, it } from "vitest";

import { getConversationErrors } from "@/core/errors";
import { getTranscript } from "@/core/read";

import { seededTempDb } from "./helpers/temp-db";

const FIXTURES_ROOT = path.join(import.meta.dirname, "fixtures", "error-logs");

describe("getConversationErrors", () => {
  const db = seededTempDb({ prefix: "cca-errors-", logsRoot: FIXTURES_ROOT });

  it("returns every failed main-thread turn, oldest first", async () => {
    const errors = await getConversationErrors("sess-err-main", {
      dbPath: db.dbPath,
    });

    expect(errors.map((e) => e.messageUuid)).toEqual(["ea2", "ea3"]);
    expect(errors.map((e) => e.timestamp)).toEqual(["2026-06-21T08:00:10.000Z", "2026-06-21T08:00:20.000Z"]);
  });

  it("carries the API status verbatim, or null when the log omitted it", async () => {
    const errors = await getConversationErrors("sess-err-main", {
      dbPath: db.dbPath,
    });

    expect(errors[0].status).toBe("overloaded_error");
    expect(errors[1].status).toBeNull();
  });

  it("excerpts the failed turn's text, capped so a long failure stays a preview", async () => {
    const errors = await getConversationErrors("sess-err-main", {
      dbPath: db.dbPath,
    });

    expect(errors[0].excerpt).toBe("API Error: Overloaded");
    expect(errors[1].excerpt.length).toBe(160);
    expect(errors[1].excerpt.startsWith("API Error: the upstream request")).toBe(true);
  });

  it("keys a main-thread failure to the agent its transcript is reached by", async () => {
    const [first] = await getConversationErrors("sess-err-main", {
      dbPath: db.dbPath,
    });
    const transcript = await getTranscript("sess-err-main", {
      dbPath: db.dbPath,
    });

    expect(first.agentId).toBe(transcript?.tree.id);
    expect(first.agentType ?? "").toBe("");
  });

  it("reports a sub-agent's failure with its own agent key and type", async () => {
    const errors = await getConversationErrors("sess-err-sub", {
      dbPath: db.dbPath,
    });

    expect(errors).toHaveLength(1);
    expect(errors[0].agentId).toBe("esub1");
    expect(errors[0].agentType).toBe("Explore");
    expect(errors[0].messageUuid).toBe("esa1");
    expect(errors[0].status).toBe("rate_limit_error");
    expect(errors[0].excerpt).toBe("");
  });

  it("puts a failure the log never timestamped LAST, not first", async () => {
    const errors = await getConversationErrors("sess-err-undated", {
      dbPath: db.dbPath,
    });

    expect(errors.map((e) => e.messageUuid)).toEqual(["da2", "da1"]);
    expect(errors[1].timestamp).toBe("");
  });

  it("returns nothing for a conversation that never failed", async () => {
    expect(await getConversationErrors("sess-err-clean", { dbPath: db.dbPath })).toEqual([]);
  });

  it("returns nothing for an unknown session id", async () => {
    expect(await getConversationErrors("sess-nope", { dbPath: db.dbPath })).toEqual([]);
  });
});
