import { describe, expect, it } from "vitest";

import {
  DEFAULT_SORT,
  isSortableField,
  modelLabel,
  resolveSort,
  sortHref,
  sortIndicator,
  toggleSort,
} from "@/app/_lib/sort";

describe("resolveSort", () => {
  it("defaults to costUsd desc when no params are given", () => {
    expect(resolveSort(undefined, undefined)).toEqual(DEFAULT_SORT);
    expect(DEFAULT_SORT).toEqual({ sortBy: "costUsd", dir: "desc" });
  });

  it("uses valid sortBy + dir from params", () => {
    expect(resolveSort("title", "asc")).toEqual({ sortBy: "title", dir: "asc" });
  });

  it("ignores an unsortable / unknown field and falls back to the default", () => {
    // tokens is a nested object the core cannot sort by — must not be honored.
    expect(resolveSort("tokens", "asc")).toEqual(DEFAULT_SORT);
    expect(resolveSort("bogus", "asc")).toEqual(DEFAULT_SORT);
  });

  it("falls back to the field's default dir when dir is missing or invalid", () => {
    // costUsd defaults to desc.
    expect(resolveSort("costUsd", undefined)).toEqual({
      sortBy: "costUsd",
      dir: "desc",
    });
    // title defaults to asc.
    expect(resolveSort("title", "sideways")).toEqual({
      sortBy: "title",
      dir: "asc",
    });
  });

  it("reads the first value when a param arrives as an array", () => {
    expect(resolveSort(["title", "id"], ["asc", "desc"])).toEqual({
      sortBy: "title",
      dir: "asc",
    });
  });
});

describe("isSortableField", () => {
  it("accepts top-level scalar fields the core can sort", () => {
    expect(isSortableField("costUsd")).toBe(true);
    expect(isSortableField("title")).toBe(true);
  });

  it("rejects nested object fields the core cannot sort", () => {
    expect(isSortableField("tokens")).toBe(false);
    expect(isSortableField("models")).toBe(false);
    expect(isSortableField("project")).toBe(false);
  });
});

describe("toggleSort", () => {
  it("toggles asc -> desc when clicking the active field", () => {
    expect(toggleSort("title", { sortBy: "title", dir: "asc" })).toEqual({
      sortBy: "title",
      dir: "desc",
    });
  });

  it("toggles desc -> asc when clicking the active field", () => {
    expect(toggleSort("costUsd", { sortBy: "costUsd", dir: "desc" })).toEqual({
      sortBy: "costUsd",
      dir: "asc",
    });
  });

  it("starts an inactive field at its own default dir", () => {
    // Active sort is title; clicking cost (default desc) starts at desc.
    expect(toggleSort("costUsd", { sortBy: "title", dir: "asc" })).toEqual({
      sortBy: "costUsd",
      dir: "desc",
    });
    // Active sort is cost; clicking title (default asc) starts at asc.
    expect(toggleSort("title", { sortBy: "costUsd", dir: "desc" })).toEqual({
      sortBy: "title",
      dir: "asc",
    });
  });
});

describe("sortHref", () => {
  it("encodes the toggled sort as a query string", () => {
    expect(sortHref("title", { sortBy: "costUsd", dir: "desc" })).toBe(
      "?sortBy=title&dir=asc",
    );
  });

  it("encodes the flipped dir when re-clicking the active field", () => {
    expect(sortHref("costUsd", { sortBy: "costUsd", dir: "desc" })).toBe(
      "?sortBy=costUsd&dir=asc",
    );
  });
});

describe("sortIndicator", () => {
  it("shows an up arrow for the active ascending field", () => {
    expect(sortIndicator("title", { sortBy: "title", dir: "asc" })).toBe("↑");
  });

  it("shows a down arrow for the active descending field", () => {
    expect(sortIndicator("costUsd", { sortBy: "costUsd", dir: "desc" })).toBe(
      "↓",
    );
  });

  it("shows nothing for an inactive field", () => {
    expect(sortIndicator("title", { sortBy: "costUsd", dir: "desc" })).toBe("");
  });
});

describe("modelLabel", () => {
  it("returns just the dominant model when there is a single model", () => {
    expect(modelLabel({ dominant: "opus", distinctCount: 1 })).toEqual({
      dominant: "opus",
      extra: 0,
    });
  });

  it("reports the count of OTHER models as `extra` when there are several", () => {
    // distinctCount 3 means the dominant + 2 others, so extra = 2 (+2 badge).
    expect(modelLabel({ dominant: "opus", distinctCount: 3 })).toEqual({
      dominant: "opus",
      extra: 2,
    });
  });

  it("never reports a negative extra", () => {
    expect(modelLabel({ dominant: "", distinctCount: 0 })).toEqual({
      dominant: "",
      extra: 0,
    });
  });
});
