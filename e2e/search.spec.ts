import { instant } from "@next/playwright";
import { test } from "@playwright/test";

import { type RouteShell, expectData, expectInstantLoad, expectShell } from "./route-shell";

// A seeded conversation title (`scripts/seed/fake-logs.ts`), so the query has a match.
const QUERY = "billing";
const RESULT = "Split the billing service out of the monolith";

const search: RouteShell = {
  shell: (page) => [page.getByRole("heading", { level: 1, name: "Search" })],
  fallbacks: (page) => [page.getByRole("status", { name: "Loading results" })],
  data: (page) => [page.getByRole("link", { name: RESULT })],
};

test.describe("Search (/search)", () => {
  test("is instant on an initial page load", async ({ page, baseURL }) => {
    await expectInstantLoad(page, baseURL, `/search?q=${QUERY}`, search);
  });

  test("is instant on a client navigation", async ({ page }) => {
    await page.goto("/");
    await instant(page, async () => {
      const searchBox = page.getByRole("searchbox", { name: "Search conversations" });
      await searchBox.fill(QUERY);
      await searchBox.press("Enter");
      await page.waitForURL((url) => url.pathname === "/search");
      await expectShell(page, search);
    });
    await expectData(page, search);
  });
});
