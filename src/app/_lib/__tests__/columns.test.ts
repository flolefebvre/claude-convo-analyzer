import { describe, expect, it } from "vitest";

import { columnCount, footerLabelColSpan } from "@/app/_lib/columns";

describe("columnCount", () => {
  it("renders all six columns when unscoped", () => {
    expect(columnCount(false)).toBe(6);
  });

  it("drops the Folder column when scoped", () => {
    expect(columnCount(true)).toBe(5);
  });
});

describe("footerLabelColSpan", () => {
  it("spans the four leading label columns when unscoped", () => {
    expect(footerLabelColSpan(false)).toBe(4);
  });

  it("spans one fewer when the Folder column is hidden", () => {
    expect(footerLabelColSpan(true)).toBe(3);
  });
});
