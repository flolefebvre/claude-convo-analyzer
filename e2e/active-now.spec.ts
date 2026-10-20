// Active now (GLOSSARY.md, under Live): the one spec that switches Live and
// writes under the seeded roots. A Live Refresh re-renders every open page, so
// `playwright.config.ts` runs this file in its `shared-state` project, after
// every other spec, never beside an `instant()` scope.

import { appendFileSync, readdirSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { expect, test, type Locator, type Page } from "@playwright/test";

// The seeded `~/dev/acme-api` repo, whose own Project holds {@link ACTIVE_TITLE}.
const REPO = path.join(os.homedir(), "dev", "acme-api");

// The seeded Conversation that no other test names: the one this spec writes to.
const ACTIVE_TITLE = "Recover a session whose records state no cwd";

// The seeded logs root the e2e server reads (`scripts/dev-seed/serve-seeded.ts`).
const SEEDED_LOGS_ROOT = path.join("data", "seed", "projects");

test.describe("Active now", () => {
  // The only tests that switch Live, and the only ones that write under the seeded roots: Live is off between them.
  test.describe.configure({ mode: "serial" });

  const liveToggle = (page: Page) => page.getByRole("banner").getByRole("button", { name: "Live" });
  const activeNowMarkers = (scope: Page | Locator) => scope.getByTitle(/^Active now/);
  /** The list, narrowed to {@link REPO}'s own Project, where {@link ACTIVE_TITLE} is on the first page. */
  const repoListPath = `/?${new URLSearchParams({ folder: REPO, thisFolder: "1" }).toString()}`;
  const activeRow = (page: Page) =>
    page
      .locator("#conversations")
      .getByRole("row")
      .filter({ has: page.getByRole("link", { name: ACTIVE_TITLE, exact: true }) });

  /** The seeded log of the Conversation titled `title`, found by its `ai-title` record. */
  function seededLogTitled(title: string): string {
    const logs = readdirSync(SEEDED_LOGS_ROOT, { recursive: true, withFileTypes: true }).filter(
      (entry) => entry.isFile() && entry.name.endsWith(".jsonl"),
    );
    const titleRecord = JSON.stringify({ type: "ai-title", aiTitle: title });
    const log = logs.find((entry) =>
      readFileSync(path.join(entry.parentPath, entry.name), "utf8").startsWith(titleRecord),
    );
    if (log === undefined) throw new Error(`no seeded log is titled ${title}`);
    return path.join(log.parentPath, log.name);
  }

  /** Append the same title record again to {@link ACTIVE_TITLE}'s log: the log changes, and nothing it shows does. */
  function touchActiveLog(): void {
    appendFileSync(seededLogTitled(ACTIVE_TITLE), JSON.stringify({ type: "ai-title", aiTitle: ACTIVE_TITLE }) + "\n");
  }

  test("marks no Conversation while Live is off, even one just changed", async ({ page }) => {
    await page.goto(repoListPath);
    await expect(liveToggle(page)).toHaveAttribute("aria-pressed", "false");

    touchActiveLog();
    await page.getByRole("banner").getByRole("button", { name: "Refresh" }).click();
    await expect(page.getByRole("banner").getByText("1 conversation updated").first()).toBeAttached({
      timeout: 20_000,
    });
    // A fresh render, of the change the Refresh just stored.
    await page.reload();

    await expect(activeRow(page)).toBeVisible();
    await expect(activeNowMarkers(page)).toHaveCount(0);
  });

  test("keeps the keyboard focus on the Live toggle through a switch, and ignores a second Enter meanwhile", async ({
    page,
  }) => {
    await page.goto(repoListPath);
    await expect(liveToggle(page)).toHaveAttribute("aria-pressed", "false");

    // Holds every server action's request until `releaseActions()`, so the switch stays pending meanwhile.
    let releaseActions = () => {};
    const actionsReleased = new Promise<void>((resolve) => {
      releaseActions = resolve;
    });
    let actionRequestCount = 0;
    await page.route("**/*", async (route) => {
      const request = route.request();
      if (request.method() !== "POST" || (await request.headerValue("next-action")) === null) {
        return route.fallback();
      }
      actionRequestCount += 1;
      await actionsReleased;
      await route.continue();
    });

    await liveToggle(page).focus();
    await page.keyboard.press("Enter");
    try {
      await expect(liveToggle(page)).toHaveAttribute("aria-disabled", "true");
      await expect(liveToggle(page)).toBeFocused();
      await page.keyboard.press("Enter");

      releaseActions();
      await expect(liveToggle(page)).toHaveAttribute("aria-pressed", "true");
      await expect(liveToggle(page)).toHaveAttribute("aria-disabled", "false");
      await expect(liveToggle(page)).toBeFocused();
      expect(actionRequestCount).toBe(1);
    } finally {
      releaseActions();
      await page.unrouteAll({ behavior: "wait" });
      // A switch still pending would land after the check below.
      await expect(liveToggle(page)).toBeEnabled();
      if ((await liveToggle(page).getAttribute("aria-pressed")) === "true") await liveToggle(page).click();
      await expect(liveToggle(page)).toHaveAttribute("aria-pressed", "false");
    }
  });

  test("marks a Conversation written to while Live is on, until two quiet minutes pass", async ({ page }) => {
    // Before the page loads, so its timers run on the clock the test advances.
    await page.clock.install();
    await page.goto(repoListPath);
    await expect(activeRow(page)).toBeVisible();
    await expect(activeNowMarkers(activeRow(page))).toHaveCount(0);

    await liveToggle(page).click();
    try {
      await expect(liveToggle(page)).toHaveAttribute("aria-pressed", "true");
      touchActiveLog();

      // Live's window, then the Refresh it runs, then the page's re-render.
      await expect(activeNowMarkers(activeRow(page))).toBeVisible({ timeout: 20_000 });
      // Its Transcript, in a second tab on the same clock, marks it beside its title.
      const transcript = await page.context().newPage();
      const href = await activeRow(page).getByRole("link", { name: ACTIVE_TITLE, exact: true }).getAttribute("href");
      await transcript.goto(href ?? "");
      await expect(activeNowMarkers(transcript.getByRole("complementary", { name: "Agent tree" }))).toBeVisible();

      await page.clock.fastForward("02:00");
      await expect(activeNowMarkers(page)).toHaveCount(0);
      await expect(activeNowMarkers(transcript)).toHaveCount(0);
    } finally {
      if ((await liveToggle(page).getAttribute("aria-pressed")) === "true") await liveToggle(page).click();
      await expect(liveToggle(page)).toHaveAttribute("aria-pressed", "false");
    }
  });
});
