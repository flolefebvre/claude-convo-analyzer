import type { Page } from "@playwright/test";

/**
 * `page.goto(path)`, resolved only once the app bar's client controls take input.
 *
 * Playwright's `load` does not mean that. React streams each Suspense boundary's content behind its
 * fallback, and its runtime (`$RC`/`$RV`) reveals completed boundaries in batches, on the next animation
 * frame or 300 ms after the last reveal, which can be after `load`. Until then the page shows the
 * fallback, and `InertLiveToggle`, `IdleRefreshButton` and the search box's `SearchField` look exactly
 * like the controls they stand for, with no handler: a click or a keypress on one is lost, and the
 * reveal replaces it, focus and typed text included. A new fallback that looks like its control needs
 * this wait in any spec that acts on that control right after a load.
 *
 * The evidence waited for is the page's subscription to the `refresh` Channel (`/api/sse`):
 * - it is sent from `RefreshButton`'s subscription effect, so the Refresh boundary is revealed and hydrated;
 * - the search box's and the Live toggle's boundaries precede it in the stream, so they are revealed by then;
 * - React hydrates a revealed, not yet hydrated boundary synchronously on a click or a keypress, then
 *   handles the event.
 *
 * @example await gotoInteractive(page, "/");
 */
export async function gotoInteractive(page: Page, path: string): Promise<void> {
  // Waited for from before the load, which may send the request before `goto` resolves.
  await Promise.all([
    page.waitForRequest((request) => {
      const url = new URL(request.url());
      return url.pathname === "/api/sse" && url.searchParams.getAll("channel").includes("refresh");
    }),
    page.goto(path),
  ]);
}
