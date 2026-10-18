import { describe, expect, it } from "vitest";

import { columnCount, footerLabelColSpan } from "@/app/_lib/columns";

// The table drops the Folder column when every row in scope comes from one
// Project, so the header/body cell count and the footer's label colSpan both
// shrink by one. Centralizing the count here keeps header, body, and footer
// from drifting.
describe("columnCount", () => {
  it("renders all six columns with the Folder column shown", () => {
    expect(columnCount(false)).toBe(6);
  });

  it("drops the Folder column when it is hidden", () => {
    expect(columnCount(true)).toBe(5);
  });
});

describe("footerLabelColSpan", () => {
  it("spans the four leading label columns with the Folder column shown", () => {
    expect(footerLabelColSpan(false)).toBe(4);
  });

  it("spans one fewer when the Folder column is hidden", () => {
    expect(footerLabelColSpan(true)).toBe(3);
  });

  // Narrow tables hide Folder and Model(s): Date and Title are the only label
  // columns left, Folder column hidden or not.
  it("spans Date and Title only in the compact layout", () => {
    expect(footerLabelColSpan(false, { compact: true })).toBe(2);
    expect(footerLabelColSpan(true, { compact: true })).toBe(2);
  });
});
