import { describe, expect, it } from "vitest";

import type { ToolStat } from "@/core/tool-stats";
import {
  DEFAULT_TOOL_SORT,
  resolveToolSort,
  sortTools,
  toolExpandHref,
  toolLabel,
  toolRangeHref,
  toolSortHref,
  toolSortIndicator,
  toggleToolSort,
} from "@/app/_lib/tools";

/** A `ToolStat` with only the fields the sort/labels care about. */
function stat(name: string, calls: number, errorRate: number, totalSize: number): ToolStat {
  return {
    name,
    calls,
    errors: Math.round(calls * errorRate),
    errorRate,
    sizedCalls: calls,
    meanSize: 0,
    p50Size: 0,
    p95Size: 0,
    maxSize: 0,
    totalSize,
  };
}

/** The view state a Tools page link is built from. */
const STATE = {
  sort: DEFAULT_TOOL_SORT,
  folder: "-Users-me-dev-app",
  range: "7",
} as const;

describe("resolveToolSort", () => {
  it("defaults to calls descending when the URL carries no (valid) sort", () => {
    expect(resolveToolSort(undefined, undefined)).toEqual(DEFAULT_TOOL_SORT);
    // A conversation-list column arriving from a shared sidebar link is not a
    // Tools column: it falls back instead of throwing the table off.
    expect(resolveToolSort("date", "asc")).toEqual(DEFAULT_TOOL_SORT);
    expect(DEFAULT_TOOL_SORT).toEqual({ sortBy: "calls", dir: "desc" });
  });

  it("accepts each column, taking the first value when a param repeats", () => {
    expect(resolveToolSort("errorRate", "asc")).toEqual({
      sortBy: "errorRate",
      dir: "asc",
    });
    expect(resolveToolSort(["volume", "calls"], ["desc"])).toEqual({
      sortBy: "volume",
      dir: "desc",
    });
    // An invalid direction falls back to the column's own default.
    expect(resolveToolSort("volume", "sideways")).toEqual({
      sortBy: "volume",
      dir: "desc",
    });
  });
});

describe("toggleToolSort", () => {
  it("flips the active column and starts a fresh one descending", () => {
    expect(toggleToolSort("calls", DEFAULT_TOOL_SORT)).toEqual({
      sortBy: "calls",
      dir: "asc",
    });
    expect(toggleToolSort("volume", DEFAULT_TOOL_SORT)).toEqual({
      sortBy: "volume",
      dir: "desc",
    });
  });
});

describe("sortTools", () => {
  const tools = [
    stat("Bash", 10, 0.1, 500),
    stat("Read", 20, 0, 9000),
    stat("Edit", 10, 0.5, 100),
  ];

  it("orders by the active column, ties broken by name", () => {
    expect(sortTools(tools, { sortBy: "calls", dir: "desc" }).map((t) => t.name)).toEqual([
      "Read",
      "Bash",
      "Edit",
    ]);
    expect(
      sortTools(tools, { sortBy: "errorRate", dir: "desc" }).map((t) => t.name),
    ).toEqual(["Edit", "Bash", "Read"]);
    expect(sortTools(tools, { sortBy: "volume", dir: "asc" }).map((t) => t.name)).toEqual([
      "Edit",
      "Bash",
      "Read",
    ]);
  });

  it("returns a new array, leaving the input untouched", () => {
    const before = tools.map((t) => t.name);
    sortTools(tools, { sortBy: "volume", dir: "desc" });
    expect(tools.map((t) => t.name)).toEqual(before);
  });
});

describe("tool table hrefs", () => {
  it("keeps folder, range, and the expanded row when re-sorting", () => {
    expect(toolSortHref("volume", { ...STATE, expanded: "Bash" })).toBe(
      "?sortBy=volume&dir=desc&folder=-Users-me-dev-app&range=7&expanded=Bash",
    );
  });

  it("keeps sort and scope when changing range", () => {
    expect(toolRangeHref("all", STATE)).toBe(
      "?sortBy=calls&dir=desc&folder=-Users-me-dev-app&range=all",
    );
  });

  it("expands a row, and collapses the one already expanded", () => {
    expect(toolExpandHref("Bash", STATE)).toBe(
      "?sortBy=calls&dir=desc&folder=-Users-me-dev-app&range=7&expanded=Bash",
    );
    expect(toolExpandHref("Bash", { ...STATE, expanded: "Bash" })).toBe(
      "?sortBy=calls&dir=desc&folder=-Users-me-dev-app&range=7",
    );
  });
});

describe("toolSortIndicator", () => {
  it("marks only the active column", () => {
    expect(toolSortIndicator("calls", DEFAULT_TOOL_SORT)).toBe("↓");
    expect(toolSortIndicator("calls", { sortBy: "calls", dir: "asc" })).toBe("↑");
    expect(toolSortIndicator("volume", DEFAULT_TOOL_SORT)).toBe("");
  });
});

describe("toolLabel", () => {
  it("splits an MCP tool into its server and tool halves", () => {
    expect(toolLabel("mcp__github__create_issue")).toEqual({
      server: "github",
      tool: "create_issue",
    });
    // A tool name containing the separator keeps its own tail intact.
    expect(toolLabel("mcp__ide__get__diagnostics")).toEqual({
      server: "ide",
      tool: "get__diagnostics",
    });
  });

  it("leaves an ordinary tool name alone", () => {
    expect(toolLabel("Bash")).toEqual({ server: null, tool: "Bash" });
    // Malformed MCP names are shown verbatim rather than mangled.
    expect(toolLabel("mcp__github")).toEqual({ server: null, tool: "mcp__github" });
  });
});
