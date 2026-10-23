// What a pushed `v*` tag means to the release workflow, given package.json's version.

import { describe, expect, it } from "vitest";

import { releaseTagKind } from "./release-tag";

describe("releaseTagKind", () => {
  it("is a release for v and exactly the version", () => {
    expect(releaseTagKind("v0.1.0", "0.1.0")).toBe("release");
  });

  it("is a rehearsal for the version with a pre-release suffix", () => {
    expect(releaseTagKind("v0.1.0-rc.1", "0.1.0")).toBe("rehearsal");
    expect(releaseTagKind("v0.1.0-dry-run", "0.1.0")).toBe("rehearsal");
  });

  it("is a release when package.json's version is itself a pre-release and the tag matches it", () => {
    expect(releaseTagKind("v1.0.0-beta.2", "1.0.0-beta.2")).toBe("release");
  });

  it("throws, naming the tag and the version, for another version", () => {
    expect(() => releaseTagKind("v0.2.0", "0.1.0")).toThrow(/v0\.2\.0.*0\.1\.0/);
    expect(() => releaseTagKind("v0.1.1-rc.1", "0.1.0")).toThrow(/v0\.1\.1-rc\.1.*0\.1\.0/);
  });

  it("throws for a version that only shares a prefix", () => {
    expect(() => releaseTagKind("v0.1.00", "0.1.0")).toThrow();
    expect(() => releaseTagKind("v0.1.0.1", "0.1.0")).toThrow();
  });

  it("throws for a tag that is not v and a version", () => {
    expect(() => releaseTagKind("0.1.0", "0.1.0")).toThrow();
    expect(() => releaseTagKind("release-0.1.0", "0.1.0")).toThrow();
  });

  it("throws for an empty or malformed pre-release suffix", () => {
    expect(() => releaseTagKind("v0.1.0-", "0.1.0")).toThrow();
    expect(() => releaseTagKind("v0.1.0-rc..1", "0.1.0")).toThrow();
    expect(() => releaseTagKind("v0.1.0-rc_1", "0.1.0")).toThrow();
  });

  it("throws for build metadata", () => {
    expect(() => releaseTagKind("v0.1.0+build.5", "0.1.0")).toThrow();
    expect(() => releaseTagKind("v0.1.0-rc.1+build.5", "0.1.0")).toThrow();
  });
});
