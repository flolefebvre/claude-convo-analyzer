import { test } from "@playwright/test";

import { type RouteShell, expectInstantLoad, expectInstantSectionNavigation } from "./route-shell";

const trends: RouteShell = {
  shell: (page) => [page.getByRole("heading", { level: 1, name: "Trends" })],
  fallbacks: (page) => [
    page.getByRole("status", { name: "Loading range" }),
    page.getByRole("status", { name: "Loading trends" }),
  ],
  data: (page) => [
    page.getByRole("navigation", { name: "Range" }),
    page.getByText("Range cost", { exact: true }),
    page.getByText("Spend per day", { exact: true }),
  ],
};

test.describe("Trends (/trends)", () => {
  test("is instant on an initial page load", async ({ page, baseURL }) => {
    await expectInstantLoad(page, baseURL, "/trends", trends);
  });

  test("is instant on a client navigation", async ({ page }) => {
    await expectInstantSectionNavigation(page, "Trends", "/trends", trends);
  });
});
