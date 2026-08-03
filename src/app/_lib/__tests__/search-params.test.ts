import { describe, expect, it } from "vitest";

import { firstParam } from "@/app/_lib/search-params";

describe("firstParam", () => {
  it("returns a single value unchanged", () => {
    expect(firstParam("postgres")).toBe("postgres");
  });

  it("returns undefined when the param is absent", () => {
    expect(firstParam(undefined)).toBeUndefined();
  });

  it("takes the first value when the param repeats", () => {
    expect(firstParam(["postgres", "redis"])).toBe("postgres");
  });

  it("returns undefined for an empty repeated param", () => {
    expect(firstParam([])).toBeUndefined();
  });

  it("keeps an empty string as an empty string (the caller decides)", () => {
    expect(firstParam("")).toBe("");
  });
});
