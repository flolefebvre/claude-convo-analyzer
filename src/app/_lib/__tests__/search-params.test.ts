import { describe, expect, it } from "vitest";

import { firstParam, resolvePage } from "@/app/_lib/search-params";

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

describe("resolvePage", () => {
  it("reports NO requested page when the param is absent", () => {
    // `undefined` means "the URL asked for nothing", which lets an
    // `?expanded=<id>` or `?msg=<uuid>` link land on the page that holds it.
    expect(resolvePage(undefined)).toBeUndefined();
  });

  it("reads a valid 1-based page number", () => {
    expect(resolvePage("3")).toBe(3);
  });

  it("reads an invalid page as no request at all", () => {
    // A hand-edited URL never yields an empty page: 0, a negative, a
    // fractional or a non-numeric page all read as "no page requested".
    for (const raw of ["0", "-2", "1.5", "abc", "", " "]) {
      expect(resolvePage(raw)).toBeUndefined();
    }
  });

  it("takes the FIRST value of a repeated param, like every other resolver", () => {
    expect(resolvePage(["4", "9"])).toBe(4);
  });
});
