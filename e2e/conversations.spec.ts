import { instant } from "@next/playwright";
import { expect, test, type Page } from "@playwright/test";

// A seeded conversation title (`scripts/seed/fake-logs.ts`).
const TITLE = "Split the billing service out of the monolith";

const header = (page: Page) => page.getByRole("heading", { level: 1, name: "Conversations" });
const fallbacks = (page: Page) => [
  page.getByRole("status", { name: "Loading folders" }),
  page.getByRole("status", { name: "Loading overview" }),
  page.getByRole("status", { name: "Loading conversations" }),
];
const data = (page: Page) => [
  page.getByRole("navigation", { name: "Folders" }),
  page.getByRole("heading", { level: 2, name: /All projects/ }),
  page.getByText(TITLE, { exact: true }),
];

async function expectShell(page: Page) {
  await expect(header(page)).toBeVisible();
  for (const fallback of fallbacks(page)) await expect(fallback).toBeVisible();
  for (const region of data(page)) await expect(region).toHaveCount(0);
}

async function expectData(page: Page) {
  for (const region of data(page)) await expect(region.first()).toBeVisible();
}

test.describe("Conversations (/)", () => {
  test("is instant on an initial page load", async ({ page, baseURL }) => {
    await instant(
      page,
      async () => {
        await page.goto("/");
        await expectShell(page);
      },
      { baseURL },
    );
    await expectData(page);
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
    await expectData(page);
  });
});
