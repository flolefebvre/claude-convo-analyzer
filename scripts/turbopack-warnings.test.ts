// The build guard's detection: which part of `next build`'s output, if any, is
// Turbopack's warning block. Samples are verbatim Next.js 16.4 output.

import { describe, expect, it } from "vitest";

import { turbopackWarningBlock } from "./turbopack-warnings";

const BEFORE_WARNINGS = [
  "▲ Next.js 16.4.2 (Turbopack)",
  "✓ Compiled successfully in 6.4s",
  "  Running TypeScript ...",
  "✓ Generating static pages using 17 workers (13/13) in 1555ms",
].join("\n");

const WARNING_BLOCK = [
  "Turbopack build encountered 1 warning:",
  "./src/core/live.ts:148:9",
  "Warning: Dynamic filesystem access causes tracing of the whole project",
  "> 148 |     if (existsSync(logsRoot)) rootsToWatch.push(logsRoot);",
  "      |         ^^^^^^^^^^^^^^^^^^^^",
  "",
  "Static analysis determined that this filesystem access causes the whole project to be traced and included in the output.",
  "- opt out by adding an ignore comment to the highlighted call: fs.existsSync(/*turbopackIgnore: true*/ ...), or",
  "",
  "Import traces:",
  "  Instrumentation:",
  "    ./src/core/live.ts",
  "    ./src/instrumentation.ts",
  "",
  "",
  "  Finalizing page optimization ...",
].join("\n");

const ROUTE_TABLE = ["", "Route (app)", "┌ ◐ /", "└ ◐ /trends", "", "◐  (Partial Prerender)  prerendered"].join("\n");

describe("turbopackWarningBlock", () => {
  it("is null for a clean build's output", () => {
    expect(
      turbopackWarningBlock(`${BEFORE_WARNINGS}\n  Finalizing page optimization ...\n${ROUTE_TABLE}\n`),
    ).toBeNull();
  });

  it("is the block from its header up to the route table", () => {
    expect(turbopackWarningBlock(`${BEFORE_WARNINGS}\n${WARNING_BLOCK}\n${ROUTE_TABLE}\n`)).toBe(WARNING_BLOCK);
  });

  it("runs to the end of the output when no route table follows", () => {
    expect(turbopackWarningBlock(`${BEFORE_WARNINGS}\n${WARNING_BLOCK}\n`)).toBe(WARNING_BLOCK);
  });

  it("finds a colored block, and returns it without its color codes", () => {
    const coloredOutput = [
      "\x1b[32m\x1b[1m✓\x1b[22m\x1b[39m Compiled successfully in 6.4s",
      "Turbopack build encountered 2 warnings:",
      "./src/core/live.ts:148:9",
      "\x1b[1m\x1b[33mWarning\x1b[39m: Dynamic filesystem access causes tracing of the whole project\x1b[22m",
      "",
      "\x1b[4mRoute (app)\x1b[24m",
      "┌ ◐ /",
    ].join("\n");

    expect(turbopackWarningBlock(coloredOutput)).toBe(
      [
        "Turbopack build encountered 2 warnings:",
        "./src/core/live.ts:148:9",
        "Warning: Dynamic filesystem access causes tracing of the whole project",
      ].join("\n"),
    );
  });

  it("is null for Turbopack's errors, which fail the build on their own", () => {
    expect(turbopackWarningBlock("Turbopack build encountered 1 error:\n./src/app/page.tsx:1:1\n")).toBeNull();
  });
});
