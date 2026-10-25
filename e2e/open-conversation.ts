import type { Page } from "@playwright/test";

/**
 * Open the seeded Conversation titled `title` from the Conversations list, by a client navigation, so the
 * Transcript's client controls take input as soon as the URL changes.
 *
 * @example await openConversation(page, "Trace the slow invoice query");
 */
export async function openConversation(page: Page, title: string): Promise<void> {
  await page.goto("/");
  await page.getByRole("link", { name: title, exact: true }).click();
  await page.waitForURL((url) => url.pathname.startsWith("/conversation/"));
}
