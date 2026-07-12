import { describe, expect, it } from "vitest";

import { agentHref, resolveAgent } from "@/app/_lib/transcript-url";

describe("resolveAgent", () => {
  it("returns undefined when the param is absent (core defaults to main)", () => {
    expect(resolveAgent(undefined)).toBeUndefined();
  });

  it("returns the id for a single string value", () => {
    expect(resolveAgent("a2")).toBe("a2");
  });

  it("takes the first value when the param repeats", () => {
    expect(resolveAgent(["a2", "a3"])).toBe("a2");
  });

  it("treats an empty string as absent", () => {
    expect(resolveAgent("")).toBeUndefined();
  });
});

describe("agentHref", () => {
  it("builds a /conversation/<id>?agent=<agent> link", () => {
    expect(agentHref("sess-1", "a2")).toBe("/conversation/sess-1?agent=a2");
  });

  it("omits the query for the root/main link when no agent is given", () => {
    expect(agentHref("sess-1")).toBe("/conversation/sess-1");
  });

  it("url-encodes the session id and agent id", () => {
    expect(agentHref("a b", "x/y")).toBe("/conversation/a%20b?agent=x%2Fy");
  });
});
