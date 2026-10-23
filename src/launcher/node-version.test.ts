import { describe, expect, it } from "vitest";

import { nodeVersionProblem } from "./node-version";

describe("nodeVersionProblem", () => {
  it("accepts Node 20.9 and anything newer", () => {
    expect(nodeVersionProblem("20.9.0")).toBeNull();
    expect(nodeVersionProblem("20.18.1")).toBeNull();
    expect(nodeVersionProblem("22.0.0")).toBeNull();
    expect(nodeVersionProblem("26.1.0-pre")).toBeNull();
  });

  it("refuses an older Node in one line naming the version needed and nodejs.org", () => {
    for (const version of ["20.8.1", "18.20.4", "16.0.0", "8.17.0"]) {
      const problem = nodeVersionProblem(version);

      expect(problem).toContain("20.9");
      expect(problem).toContain(version);
      expect(problem).toContain("https://nodejs.org");
      expect(problem).not.toContain("\n");
    }
  });
});
