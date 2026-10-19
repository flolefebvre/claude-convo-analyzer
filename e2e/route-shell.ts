import { instant } from "@next/playwright";
import { expect, type Locator, type Page } from "@playwright/test";

/** What a route's `instant()` spec locates: the shell content, its Suspense fallbacks, and the streamed data. */
export type RouteShell = {
  /** Content the static shell renders (the page header, the controls). */
  shell: (page: Page) => Locator[];
  /** The `LoadingRegion`s shown until the data lands. */
  fallbacks: (page: Page) => Locator[];
  /** Streamed content, absent from the shell. */
  data: (page: Page) => Locator[];
};

/**
 * Asserts the shell and its fallbacks are visible and the streamed data is not; call inside `instant()`.
 * Every route's shell also has the app bar's neutral Recorder item and its Live and Refresh controls.
 *
 * @example await expectShell(page, tools);
 */
export async function expectShell(page: Page, route: RouteShell) {
  // The neutral item on an initial load; on a client navigation, the item as the persisting app bar shows it.
  await expect(page.getByRole("banner").getByRole("button", { name: /^Recorder/ })).toBeVisible();
  await expect(page.getByRole("banner").getByRole("button", { name: "Live", pressed: false })).toBeVisible();
  await expect(page.getByRole("banner").getByRole("button", { name: "Refresh" })).toBeVisible();
  for (const content of route.shell(page)) await expect(content).toBeVisible();
  for (const fallback of route.fallbacks(page)) await expect(fallback).toBeVisible();
  for (const region of route.data(page)) await expect(region).toHaveCount(0);
}

/**
 * Asserts the streamed data has landed; call after the `instant()` scope.
 *
 * @example await expectData(page, tools);
 */
export async function expectData(page: Page, route: RouteShell) {
  for (const region of route.data(page)) await expect(region.first()).toBeVisible();
}

/**
 * The initial-load test: `path` shows its shell under `instant()`, then its data.
 *
 * @example await expectInstantLoad(page, baseURL, "/tools", tools);
 */
export async function expectInstantLoad(page: Page, baseURL: string | undefined, path: string, route: RouteShell) {
  await instant(
    page,
    async () => {
      await page.goto(path);
      await expectShell(page, route);
    },
    { baseURL },
  );
  await expectData(page, route);
}

/**
 * The client-navigation test for a `(shell)` page: from `/`, its section tab shows the page's shell under
 * `instant()`, then its data. The sidebar belongs to the shared layout, so it is already there; `route`
 * lists only the page's own regions.
 *
 * @example await expectInstantSectionNavigation(page, "Tools", "/tools", tools);
 */
export async function expectInstantSectionNavigation(page: Page, tab: string, path: string, route: RouteShell) {
  await page.goto("/");
  await expect(page.getByRole("navigation", { name: "Folders" }).first()).toBeVisible();
  await instant(page, async () => {
    await page.getByRole("navigation", { name: "Sections" }).getByRole("link", { name: tab }).click();
    await page.waitForURL((url) => url.pathname === path);
    await expectShell(page, route);
  });
  await expectData(page, route);
}
