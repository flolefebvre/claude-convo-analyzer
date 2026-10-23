import { describe, expect, it } from "vitest";

import { nodeVersionProblem } from "./node-version";

describe("nodeVersionProblem", () => {
  it("accepts Node 22.0 and anything newer", () => {
    expect(nodeVersionProblem("22.0.0")).toBeNull();
    expect(nodeVersionProblem("22.12.0")).toBeNull();
    expect(nodeVersionProblem("24.3.0")).toBeNull();
    expect(nodeVersionProblem("26.1.0-pre")).toBeNull();
  });

  it("refuses an older Node in one line naming Node 22 and nodejs.org", () => {
    for (const version of ["21.7.3", "20.18.1", "18.20.4", "8.17.0"]) {
      const problem = nodeVersionProblem(version);

      expect(problem).toContain("needs Node.js 22 or newer");
      expect(problem).toContain(version);
      expect(problem).toContain("https://nodejs.org");
      expect(problem).not.toContain("\n");
    }
  });
});
