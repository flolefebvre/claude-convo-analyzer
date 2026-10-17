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
 *
 * @example await expectShell(page, tools);
 */
export async function expectShell(page: Page, route: RouteShell) {
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
