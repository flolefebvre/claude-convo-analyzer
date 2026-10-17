import { instant } from "@next/playwright";
import { expect, test } from "@playwright/test";

import { type RouteShell, expectData, expectShell } from "./shell-assertions";

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
    await instant(
      page,
      async () => {
        await page.goto("/tools");
        await expectShell(page, tools);
      },
      { baseURL },
    );
    await expectData(page, tools);
  });

  test("is instant on a client navigation", async ({ page }) => {
    await page.goto("/");
    // The sidebar belongs to the shared layout, so it is already there; only the page's own regions load.
    await expect(page.getByRole("navigation", { name: "Folders" }).first()).toBeVisible();
    await instant(page, async () => {
      await page.getByRole("navigation", { name: "Sections" }).getByRole("link", { name: "Tools" }).click();
      await page.waitForURL((url) => url.pathname === "/tools");
      await expectShell(page, tools);
    });
    await expectData(page, tools);
  });
});
