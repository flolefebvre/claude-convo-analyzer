import { describe, expect, it } from "vitest";

import { sideRequestCountLabel, sideRequestKindLabel, sideRequestLabel } from "@/app/_lib/side-requests";

describe("a Side request's label", () => {
  it("is its kind's", () => {
    expect(sideRequestKindLabel("session-naming")).toBe("Session naming");
    expect(sideRequestLabel({ kind: "token-count", otherKindLabel: null })).toBe("Token count");
  });

  it("is its own label for an other one, else Other", () => {
    expect(sideRequestLabel({ kind: "other", otherKindLabel: "Summarize the calls." })).toBe("Summarize the calls.");
    expect(sideRequestLabel({ kind: "other", otherKindLabel: null })).toBe("Other");
  });

  it("counts in the singular for one", () => {
    expect(sideRequestCountLabel(1)).toBe("1 Side request");
    expect(sideRequestCountLabel(6)).toBe("6 Side requests");
  });
});
