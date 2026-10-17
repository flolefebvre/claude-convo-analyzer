import { describe, expect, it } from "vitest";

import { THEME_OPTIONS, isThemeActive, stepThemeOption } from "@/app/_lib/theme";

describe("THEME_OPTIONS", () => {
  it("offers Light, Dark, and System in display order", () => {
    expect(THEME_OPTIONS.map((o) => o.value)).toEqual(["light", "dark", "system"]);
    expect(THEME_OPTIONS.map((o) => o.label)).toEqual(["Light", "Dark", "System"]);
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

describe("stepThemeOption", () => {
  it("moves to the next option on ArrowRight and ArrowDown, wrapping at the end", () => {
    expect(stepThemeOption("light", "ArrowRight")).toBe("dark");
    expect(stepThemeOption("dark", "ArrowDown")).toBe("system");
    expect(stepThemeOption("system", "ArrowRight")).toBe("light");
  });

  it("moves to the previous option on ArrowLeft and ArrowUp, wrapping at the start", () => {
    expect(stepThemeOption("system", "ArrowLeft")).toBe("dark");
    expect(stepThemeOption("light", "ArrowUp")).toBe("system");
  });

  it("jumps to the first and last options on Home and End", () => {
    expect(stepThemeOption("dark", "Home")).toBe("light");
    expect(stepThemeOption("light", "End")).toBe("system");
  });

  it("ignores every other key", () => {
    expect(stepThemeOption("dark", "Enter")).toBeNull();
    expect(stepThemeOption("dark", "a")).toBeNull();
  });
});
