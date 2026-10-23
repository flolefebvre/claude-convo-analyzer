import { readFile } from "node:fs/promises";
import os from "node:os";
import { pathToFileURL } from "node:url";

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
// The seeded Conversation with Sub-agents (issue #96), its Plan Agent call's description, and the Task prompt
// that opens the Plan Sub-agent's Transcript (`agentMessagesConversation` in `scripts/seed/fake-logs.ts`).
const AGENT_MESSAGES_TITLE = "Coordinate the search rewrite across agents";
const PLAN_CALL_DESCRIPTION = "plan the change";
const PLAN_TASK_PROMPT_TEXT = "Draft the implementation plan";

/**
 * Open the seeded Conversation titled `title`, download its export, save it under its own name, and return
 * that name, the saved file's path and its HTML.
 */
async function downloadExport(
  page: Page,
  title: string,
): Promise<{ fileName: string; filePath: string; html: string }> {
  await page.goto("/");
  await page.getByRole("link", { name: title, exact: true }).click();
  await page.waitForURL((url) => url.pathname.startsWith("/conversation/"));
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("link", { name: "Export as HTML" }).click(),
  ]);
  const fileName = download.suggestedFilename();
  // Saved under its `.html` name: the download's own path has no extension, so a browser wouldn't read it as HTML.
  const filePath = test.info().outputPath(fileName);
  await download.saveAs(filePath);
  return { fileName, filePath, html: await readFile(filePath, "utf8") };
}

/** Every `url(...)` reference inside the file's `<style>` elements. */
function styleUrls(html: string): string[] {
  const styles = [...html.matchAll(/<style>([\s\S]*?)<\/style>/g)].map((match) => match[1] ?? "");
  return styles.flatMap((css) => [...css.matchAll(/url\(\s*["']?([^"')]*)/g)].map((match) => match[1] ?? ""));
}

test.describe("Conversation export (/api/conversation/[sessionId]/export)", () => {
  test("downloads the main thread whole, as one file that references nothing outside itself", async ({ page }) => {
    const { fileName, html } = await downloadExport(page, LONG_TITLE);

    expect(fileName).toMatch(/^port-every-report-to-the-new-rendering-engine-\d{4}-\d{2}-\d{2}\.html$/);
    // The document's own references, not URLs written in the content.
    expect(html).not.toMatch(/<script/i);
    expect(html).not.toMatch(/<link/i);
    expect(html).toMatch(/<style>/);
    expect(html).not.toMatch(/\ssrcset?\s*=\s*["']?(https?:|\/_next\/)/i);
    expect(styleUrls(html).length).toBeGreaterThan(0);
    expect(styleUrls(html).filter((url) => !url.startsWith("data:"))).toEqual([]);
    expect(html).not.toContain("sourceMappingURL");
    // Nor the address the handler fetched the page from.
    expect(html).not.toMatch(/https?:\/\/(localhost|127\.0\.0\.1)/);
    // The home directory, which every seeded Project sits under, reads `~`.
    expect(html).not.toContain(os.homedir());
    expect(html).not.toContain(os.homedir().replaceAll("\\", "\\\\"));
    expect(html).toMatch(/<dd>~[\\/]dev[\\/][\w-]+<\/dd>/);
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

  test("opened from disk, requests nothing but itself and renders with the app's fonts", async ({ page }) => {
    const { filePath } = await downloadExport(page, LONG_TITLE);
    const requestedUrls: string[] = [];
    page.on("request", (request) => requestedUrls.push(request.url()));

    const fileUrl = pathToFileURL(filePath).href;
    await page.goto(fileUrl);
    await page.evaluate(() => document.fonts.ready);

    // `check` alone is true when no face matches at all; `load` resolves to the faces that do.
    const loadedGeistFaces = await page.evaluate(async () => (await document.fonts.load("16px Geist")).length);
    expect(loadedGeistFaces).toBeGreaterThan(0);
    expect(await page.evaluate(() => document.fonts.check("16px Geist"))).toBe(true);
    expect(requestedUrls).toEqual([fileUrl]);
  });

  test("opened from disk, follows the OS color scheme", async ({ page }) => {
    const { filePath } = await downloadExport(page, LONG_TITLE);
    await page.goto(pathToFileURL(filePath).href);
    // Native widgets (scrollbars) follow the OS scheme too.
    expect(await page.evaluate(() => getComputedStyle(document.documentElement).colorScheme)).toBe("light dark");
    // A color as the sRGB pixel it paints, so the comparison doesn't depend on how the CSS spells it.
    const pixelOf = (color: string) =>
      page.evaluate((cssColor) => {
        const context = document.createElement("canvas").getContext("2d")!;
        context.fillStyle = cssColor;
        context.fillRect(0, 0, 1, 1);
        return [...context.getImageData(0, 0, 1, 1).data];
      }, color);
    const bodyBackgroundPixel = async () =>
      pixelOf(await page.evaluate(() => getComputedStyle(document.body).backgroundColor));

    // `--background` in each theme (globals.css).
    await page.emulateMedia({ colorScheme: "dark" });
    expect(await bodyBackgroundPixel()).toEqual(await pixelOf("oklch(0.145 0 0)"));
    await page.emulateMedia({ colorScheme: "light" });
    expect(await bodyBackgroundPixel()).toEqual(await pixelOf("oklch(1 0 0)"));
  });

  test("holds every Agent's Transcript, one shown at a time, switched by in-file links with no script", async ({
    page,
  }) => {
    const { filePath, html } = await downloadExport(page, AGENT_MESSAGES_TITLE);

    expect(html).toContain(PLAN_TASK_PROMPT_TEXT);
    expect(html).not.toMatch(/<script/i);
    expect(html).not.toMatch(/<link/i);
    const ids = [...html.matchAll(/\sid="([^"]*)"/g)].map((match) => match[1]);
    expect(ids.filter((id, i) => ids.indexOf(id) !== i)).toEqual([]);

    await page.goto(pathToFileURL(filePath).href);
    const mainSection = page.getByRole("region", { name: "main transcript" });
    const planSection = page.getByRole("region", { name: "Plan transcript" });
    const planNodeIn = (section: typeof mainSection) =>
      section.getByRole("navigation", { name: "Agents" }).getByRole("link").filter({ hasText: "Plan" });
    // With no fragment, the main thread.
    await expect(mainSection).toBeVisible();
    await expect(planSection).toBeHidden();

    await planNodeIn(mainSection).click();
    await expect(planSection).toBeVisible();
    await expect(mainSection).toBeHidden();
    await expect(planNodeIn(planSection)).toHaveAttribute("aria-current", "page");
    await expect(planSection.getByRole("article").filter({ hasText: PLAN_TASK_PROMPT_TEXT })).toBeVisible();

    // Back to the Agent call that spawned it, in view.
    await planSection.getByRole("link", { name: "Back to the Agent call in main" }).click();
    await expect(mainSection).toBeVisible();
    await expect(planSection).toBeHidden();
    const planCall = mainSection.getByRole("group").filter({ hasText: PLAN_CALL_DESCRIPTION }).first();
    await expect(planCall).toBeInViewport();

    // Its summary: the body holds the description too.
    await planCall.getByText(PLAN_CALL_DESCRIPTION).first().click();
    await planCall.getByRole("link", { name: "Open transcript" }).click();
    await expect(planSection).toBeVisible();
    await expect(mainSection).toBeHidden();

    // On paper, every Agent's section.
    await page.emulateMedia({ media: "print" });
    await expect(mainSection).toBeVisible();
    await expect(planSection).toBeVisible();
  });

  test("keeps the thinking and leaves What was sent out", async ({ page }) => {
    const { html } = await downloadExport(page, LOGGED_REQUESTS_TITLE);

    expect(html).toContain(LOGGED_REQUESTS_THINKING_TEXT);
    expect(html).not.toContain("What was sent");
  });
});
