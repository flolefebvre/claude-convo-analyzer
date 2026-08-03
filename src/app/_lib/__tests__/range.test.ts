import { describe, expect, it } from "vitest";

import {
  DEFAULT_RANGE,
  rangeDays,
  rangeHref,
  resolveRange,
} from "@/app/_lib/range";

describe("resolveRange", () => {
  it("defaults to 30 days when the URL carries no (valid) range", () => {
    expect(resolveRange(undefined)).toBe(DEFAULT_RANGE);
    expect(resolveRange("")).toBe(DEFAULT_RANGE);
    expect(resolveRange("60")).toBe(DEFAULT_RANGE);
    expect(resolveRange("../etc")).toBe(DEFAULT_RANGE);
    expect(DEFAULT_RANGE).toBe("30");
  });

  it("accepts each preset, taking the first value when the param repeats", () => {
    expect(resolveRange("7")).toBe("7");
    expect(resolveRange("90")).toBe("90");
    expect(resolveRange("all")).toBe("all");
    expect(resolveRange(["7", "90"])).toBe("7");
  });
});

describe("rangeDays", () => {
  it("maps a preset to the core's day count, and all time to none", () => {
    expect(rangeDays("7")).toBe(7);
    expect(rangeDays("30")).toBe(30);
    expect(rangeDays("90")).toBe(90);
    expect(rangeDays("all")).toBeUndefined();
  });
});

describe("rangeHref", () => {
  it("keeps the active folder scope so both axes compose", () => {
    expect(rangeHref("7", "-Users-me-dev-app")).toBe(
      "?range=7&folder=-Users-me-dev-app",
    );
  });

  it("omits an absent or empty folder scope", () => {
    expect(rangeHref("all")).toBe("?range=all");
    expect(rangeHref("90", "")).toBe("?range=90");
  });
});
