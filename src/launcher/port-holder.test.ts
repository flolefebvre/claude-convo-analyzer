import { describe, expect, it } from "vitest";

import { classifyPort } from "./port-holder";

const PACKAGE_NAME = "claude-convo-analyzer";

describe("classifyPort", () => {
  it("is free when the launcher could bind it", () => {
    expect(classifyPort({ isBindable: true, identity: undefined }, PACKAGE_NAME)).toEqual({ kind: "free" });
  });

  it("is held by this app when the holder's identity names this package, with the version it runs", () => {
    const identity = { name: PACKAGE_NAME, version: "0.1.0" };

    expect(classifyPort({ isBindable: false, identity }, PACKAGE_NAME)).toEqual({ kind: "this app", version: "0.1.0" });
  });

  it("is held by another program when the holder answers anything else, or nothing", () => {
    for (const identity of [
      undefined,
      null,
      "<html>",
      { name: "some-other-app", version: "1.0.0" },
      { name: PACKAGE_NAME },
      { name: PACKAGE_NAME, version: 1 },
    ]) {
      expect(classifyPort({ isBindable: false, identity }, PACKAGE_NAME)).toEqual({ kind: "another program" });
    }
  });
});
