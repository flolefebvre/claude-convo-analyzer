import { test } from "@playwright/test";

import { type RouteShell, expectInstantLoad, expectInstantSectionNavigation } from "./route-shell";

const tools: RouteShell = {
  shell: (page) => [page.getByRole("heading", { level: 1, name: "Tools" })],
  fallbacks: (page) => [
    page.getByRole("status", { name: "Loading range" }),
    page.getByRole("status", { name: "Loading tools" }),
  ],
  data: (page) => [
    page.getByRole("navigation", { name: "Range" }),
    page.getByText("Tool calls", { exact: true }),
    page.getByRole("columnheader", { name: "Volume" }),
  ],
};

test.describe("Tools (/tools)", () => {
  test("is instant on an initial page load", async ({ page, baseURL }) => {
    await expectInstantLoad(page, baseURL, "/tools", tools);
  });

  test("is instant on a client navigation", async ({ page }) => {
    await expectInstantSectionNavigation(page, "Tools", "/tools", tools);
  });
});
