import { readFile } from "node:fs/promises";

import { expect, test, type Page } from "@playwright/test";

// The export page (`/conversation/[sessionId]/export`) is `instant = false` and gets no `instant()` spec
// (docs/codebase/testing.md): this spec downloads what it becomes through the Transcript view's button.

// The seeded Conversation whose main thread spans three Transcript pages, with Tool calls (issue #82).
const LONG_TITLE = "Port every report to the new rendering engine";
const LONG_MESSAGE_COUNT = 450;
const LONG_PAGE_TWO_TEXT = "Now port the quarterly heatmap export the same way.";
// The start of every seeded successful Tool result (`RESULT_FILLER` in `scripts/seed/fake-logs.ts`).
const TOOL_RESULT_TEXT = "export function handler(req: Request) { const user = await lookup(req); return json(user); }";
// The seeded Conversation whose log records its API requests (What was sent) and its thinking (issue #215).
const LOGGED_REQUESTS_TITLE = "Trace the slow invoice query";
const LOGGED_REQUESTS_THINKING_TEXT =
  "Eight seconds on a list suggests a missing index or an N+1. Checking the query plan before reading the code.";

/** Open the seeded Conversation titled `title`, download its export, and return the file's name and HTML. */
async function downloadExport(page: Page, title: string): Promise<{ fileName: string; html: string }> {
  await page.goto("/");
  await page.getByRole("link", { name: title, exact: true }).click();
  await page.waitForURL((url) => url.pathname.startsWith("/conversation/"));
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("link", { name: "Export as HTML" }).click(),
  ]);
  const path = await download.path();
  return { fileName: download.suggestedFilename(), html: await readFile(path, "utf8") };
}

test.describe("Conversation export (/api/conversation/[sessionId]/export)", () => {
  test("downloads the main thread whole, as one file with no script and no URL into the app", async ({ page }) => {
    const { fileName, html } = await downloadExport(page, LONG_TITLE);

    expect(fileName).toMatch(/^port-every-report-to-the-new-rendering-engine-\d{4}-\d{2}-\d{2}\.html$/);
    expect(html).not.toMatch(/<script/i);
    expect(html).not.toMatch(/<link/i);
    expect(html).toMatch(/<style>/);
    expect(html).not.toMatch(/https?:\/\/(localhost|127\.0\.0\.1)/);
    // Every Message across its three Transcript pages, and no pager.
    expect(html.match(/<article\b/g)).toHaveLength(LONG_MESSAGE_COUNT);
    expect(html).toContain(LONG_PAGE_TWO_TEXT);
    expect(html).not.toContain("Transcript pages");
    // A Tool call's stored result, inlined in its body.
    const firstBlockAt = html.indexOf('class="io-block"');
    expect(firstBlockAt).toBeGreaterThan(-1);
    expect(html.slice(firstBlockAt)).toContain(TOOL_RESULT_TEXT);
    expect(html).toContain("Exported from Claude Conversation Analyzer");
  });

  test("keeps the thinking and leaves What was sent out", async ({ page }) => {
    const { html } = await downloadExport(page, LOGGED_REQUESTS_TITLE);

    expect(html).toContain(LOGGED_REQUESTS_THINKING_TEXT);
    expect(html).not.toContain("What was sent");
  });
});
