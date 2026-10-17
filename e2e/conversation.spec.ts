import { instant } from "@next/playwright";
import { expect, test, type Page } from "@playwright/test";

import { type RouteShell, expectData, expectInstantLoad, expectShell } from "./route-shell";

// A seeded conversation title (`scripts/seed/fake-logs.ts`).
const TITLE = "Split the billing service out of the monolith";

const titleLink = (page: Page) => page.getByRole("link", { name: TITLE, exact: true });

const conversation: RouteShell = {
  shell: (page) => [
    page.getByRole("searchbox", { name: "Search conversations" }),
    page.getByRole("complementary", { name: "Agent tree" }),
    page.getByRole("main"),
  ],
  fallbacks: (page) => [
    page.getByRole("status", { name: "Loading back link" }),
    page.getByRole("status", { name: "Loading agent tree" }),
    page.getByRole("status", { name: "Loading transcript" }),
  ],
  data: (page) => [
    page.getByRole("navigation", { name: "Agents" }),
    page.getByRole("heading", { level: 1, name: TITLE }),
  ],
};

test.describe("Conversation (/conversation/[sessionId])", () => {
  test("is instant on an initial page load", async ({ page, baseURL }) => {
    // The session id is generated with the seed: read it off the list's link.
    await page.goto("/");
    const path = await titleLink(page).getAttribute("href");
    expect(path).toMatch(/^\/conversation\//);
    await expectInstantLoad(page, baseURL, path!, conversation);
  });

  test("is instant on a client navigation", async ({ page }) => {
    await page.goto("/");
    await instant(page, async () => {
      await titleLink(page).click();
      await page.waitForURL((url) => url.pathname.startsWith("/conversation/"));
      await expectShell(page, conversation);
    });
    await expectData(page, conversation);
  });

  test("renders the not-found page for an unknown session id", async ({ page }) => {
    await page.goto("/conversation/no-such-session");
    await expect(page.getByRole("heading", { level: 1, name: "Page not found" })).toBeVisible();
  });
});
