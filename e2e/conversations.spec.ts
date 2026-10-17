import { instant } from "@next/playwright";
import { expect, test, type Page } from "@playwright/test";

import { type RouteShell, expectData, expectShell } from "./shell-assertions";

// A seeded conversation title (`scripts/seed/fake-logs.ts`).
const TITLE = "Split the billing service out of the monolith";

const header = (page: Page) => page.getByRole("heading", { level: 1, name: "Conversations" });
const conversations: RouteShell = {
  shell: (page) => [header(page)],
  fallbacks: (page) => [
    page.getByRole("status", { name: "Loading folders" }),
    page.getByRole("status", { name: "Loading overview" }),
    page.getByRole("status", { name: "Loading conversations" }),
  ],
  data: (page) => [
    page.getByRole("navigation", { name: "Folders" }),
    page.getByRole("heading", { level: 2, name: /All projects/ }),
    page.getByText(TITLE, { exact: true }),
  ],
};

test.describe("Conversations (/)", () => {
  test("is instant on an initial page load", async ({ page, baseURL }) => {
    await instant(
      page,
      async () => {
        await page.goto("/");
        await expectShell(page, conversations);
      },
      { baseURL },
    );
    await expectData(page, conversations);
  });

  test("is instant on a client navigation", async ({ page }) => {
    await page.goto("/tools");
    // The sidebar belongs to the shared layout, so on `/tools` it is already there.
    await expect(page.getByRole("navigation", { name: "Folders" }).first()).toBeVisible();
    await instant(page, async () => {
      await page.getByRole("navigation", { name: "Sections" }).getByRole("link", { name: "Conversations" }).click();
      await page.waitForURL((url) => url.pathname === "/");
      await expect(header(page)).toBeVisible();
      await expect(page.getByRole("status", { name: "Loading overview" })).toBeVisible();
      await expect(page.getByRole("status", { name: "Loading conversations" })).toBeVisible();
      await expect(page.getByRole("heading", { level: 2, name: /All projects/ })).toHaveCount(0);
      await expect(page.getByText(TITLE, { exact: true })).toHaveCount(0);
    });
    await expectData(page, conversations);
  });
});
