import { describe, expect, it } from "vitest";

import type { ConversationApiError } from "@/core/errors";

import { errorsView } from "@/app/_lib/errors-view";

function apiError(over: Partial<ConversationApiError> = {}): ConversationApiError {
  return {
    agentId: "1",
    agentType: null,
    messageUuid: "u1",
    timestamp: "2026-06-21T08:00:10.000Z",
    status: "overloaded_error",
    excerpt: "API Error: Overloaded",
    ...over,
  };
}

describe("errorsView", () => {
  it("labels a main-thread failure 'main' and a sub-agent by its type", () => {
    const rows = errorsView("sess-1", [
      apiError({ agentType: null }),
      apiError({ agentId: "sub1", agentType: "Explore", messageUuid: "u2" }),
    ]);
    expect(rows.map((r) => r.agentLabel)).toEqual(["main", "Explore"]);
  });

  it("deep-links each error to its message in the right agent's transcript", () => {
    const [main, sub] = errorsView("sess-1", [
      apiError(),
      apiError({ agentId: "sub1", agentType: "Explore", messageUuid: "u2" }),
    ]);
    expect(main.href).toBe("/conversation/sess-1?agent=1&msg=u1#msg-u1");
    expect(sub.href).toBe("/conversation/sess-1?agent=sub1&msg=u2#msg-u2");
  });

  it("degrades to the plain agent link when the record carried no uuid", () => {
    const [row] = errorsView("sess-1", [apiError({ messageUuid: null })]);
    expect(row.href).toBe("/conversation/sess-1?agent=1");
  });

  it("shows the wall-clock time, with the full moment on hover", () => {
    const [row] = errorsView("sess-1", [apiError()]);
    expect(row.timeLabel).toBe("08:00");
    expect(row.timeAbsolute).not.toBe("");
  });

  it("leaves a missing timestamp blank rather than inventing one", () => {
    const [row] = errorsView("sess-1", [apiError({ timestamp: "" })]);
    expect(row.timeLabel).toBe("");
    expect(row.timeAbsolute).toBe("");
  });

  it("carries the status and the excerpt through verbatim", () => {
    const [row] = errorsView("sess-1", [
      apiError({ status: "rate_limit_error", excerpt: "API Error: 429" }),
    ]);
    expect(row.status).toBe("rate_limit_error");
    expect(row.excerpt).toBe("API Error: 429");
  });

  it("gives every row a distinct key, even when uuids are missing", () => {
    const rows = errorsView("sess-1", [
      apiError({ messageUuid: null }),
      apiError({ messageUuid: null, agentId: "sub1" }),
    ]);
    expect(new Set(rows.map((r) => r.key)).size).toBe(2);
  });

  it("returns nothing for a conversation with no errors", () => {
    expect(errorsView("sess-1", [])).toEqual([]);
  });
});
