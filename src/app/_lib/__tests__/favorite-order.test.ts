import { describe, expect, it } from "vitest";

import { dropIndexForPointer, moveFavoriteToIndex } from "@/app/_lib/favorite-order";

const SHOWN = ["/home/me/dev/web", "/home/me/dev/api", "/home/me/dev/docs"];

describe("moveFavoriteToIndex", () => {
  it("moves a favorite down, to go before the one that now follows it", () => {
    expect(moveFavoriteToIndex(SHOWN, "/home/me/dev/web", 1)).toEqual({
      order: ["/home/me/dev/api", "/home/me/dev/web", "/home/me/dev/docs"],
      before: "/home/me/dev/docs",
    });
  });

  it("moves a favorite up to the top", () => {
    expect(moveFavoriteToIndex(SHOWN, "/home/me/dev/docs", 0)).toEqual({
      order: ["/home/me/dev/docs", "/home/me/dev/web", "/home/me/dev/api"],
      before: "/home/me/dev/web",
    });
  });

  it("moves a favorite last, before none", () => {
    expect(moveFavoriteToIndex(SHOWN, "/home/me/dev/web", 2)).toEqual({
      order: ["/home/me/dev/api", "/home/me/dev/docs", "/home/me/dev/web"],
      before: null,
    });
  });

  it("keeps an index past either end at that end", () => {
    expect(moveFavoriteToIndex(SHOWN, "/home/me/dev/api", -1).order[0]).toBe("/home/me/dev/api");
    expect(moveFavoriteToIndex(SHOWN, "/home/me/dev/api", 3).order[2]).toBe("/home/me/dev/api");
  });
});

describe("dropIndexForPointer", () => {
  // The other rows, 40px tall, one under another from y = 100.
  const otherRowBoxes = [
    { top: 100, height: 40 },
    { top: 140, height: 40 },
  ];

  it("lands above every row the pointer is above the middle of", () => {
    expect(dropIndexForPointer(otherRowBoxes, 90)).toBe(0);
    expect(dropIndexForPointer(otherRowBoxes, 119)).toBe(0);
  });

  it("lands below a row once the pointer passes its middle", () => {
    expect(dropIndexForPointer(otherRowBoxes, 121)).toBe(1);
    expect(dropIndexForPointer(otherRowBoxes, 161)).toBe(2);
    expect(dropIndexForPointer(otherRowBoxes, 400)).toBe(2);
  });
});
