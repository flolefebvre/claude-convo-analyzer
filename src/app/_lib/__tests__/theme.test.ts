import { describe, expect, it } from "vitest";

import { THEME_OPTIONS, isThemeActive } from "@/app/_lib/theme";

describe("THEME_OPTIONS", () => {
  it("offers Light, Dark, and Auto in display order", () => {
    expect(THEME_OPTIONS.map((o) => o.value)).toEqual([
      "light",
      "dark",
      "system",
    ]);
    expect(THEME_OPTIONS.map((o) => o.label)).toEqual([
      "Light",
      "Dark",
      "Auto",
    ]);
  });
});

describe("isThemeActive", () => {
  it("matches the option equal to the current theme value", () => {
    expect(isThemeActive("light", "light")).toBe(true);
    expect(isThemeActive("dark", "dark")).toBe(true);
    expect(isThemeActive("system", "system")).toBe(true);
  });

  it("does not match a non-current option", () => {
    expect(isThemeActive("light", "dark")).toBe(false);
    expect(isThemeActive("system", "light")).toBe(false);
  });

  it("highlights nothing while the provider is unmounted (theme undefined)", () => {
    for (const { value } of THEME_OPTIONS) {
      expect(isThemeActive(value, undefined)).toBe(false);
    }
  });
});
