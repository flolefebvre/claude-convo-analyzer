import { instant } from "@next/playwright";
import { expect, test, type Page } from "@playwright/test";

import { type RouteShell, expectData, expectInstantLoad, expectShell } from "./route-shell";

// A seeded conversation title (`scripts/seed/fake-logs.ts`).
const TITLE = "Split the billing service out of the monolith";
// The seeded conversation where agents message each other (issue #96).
const AGENT_MESSAGES_TITLE = "Coordinate the search rewrite across agents";
// The seeded conversation spanning three Transcript pages, and a prompt on its second (issue #82).
const LONG_TITLE = "Port every report to the new rendering engine";
const PAGE_TWO_TEXT = "Now port the quarterly heatmap export the same way.";

const titleLink = (page: Page) => page.getByRole("link", { name: TITLE, exact: true });

const conversation: RouteShell = {
  shell: (page) => [
    page.getByRole("searchbox", { name: "Search conversations" }),
    page.getByRole("complementary", { name: "Agent tree" }),
    page.getByRole("main"),
  ],
  fallbacks: (page) => [
    page.getByRole("status", { name: "Loading back link" }),
    page.getByRole("status", { name: "Loading agent tree" }),
    page.getByRole("status", { name: "Loading transcript" }),
  ],
  data: (page) => [
    page.getByRole("navigation", { name: "Agents" }),
    page.getByRole("heading", { level: 1, name: TITLE }),
  ],
};

test.describe("Conversation (/conversation/[sessionId])", () => {
  test("is instant on an initial page load", async ({ page, baseURL }) => {
    // The session id is generated with the seed: read it off the list's link.
    await page.goto("/");
    const path = await titleLink(page).getAttribute("href");
    expect(path).toMatch(/^\/conversation\//);
    await expectInstantLoad(page, baseURL, path!, conversation);
  });

  test("is instant on a client navigation", async ({ page }) => {
    await page.goto("/");
    await instant(page, async () => {
      await titleLink(page).click();
      await page.waitForURL((url) => url.pathname.startsWith("/conversation/"));
      await expectShell(page, conversation);
    });
    await expectData(page, conversation);
  });

  test("renders the messages agents send each other, and their task notifications", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("link", { name: AGENT_MESSAGES_TITLE, exact: true }).click();
    await page.waitForURL((url) => url.pathname.startsWith("/conversation/"));

    // A sub-agent's status message, its sender linked to that sub-agent's transcript.
    const interAgent = page.getByRole("article").filter({ hasText: "Indexing is done" });
    await expect(interAgent).toHaveAccessibleName(/^From /);
    await expect(interAgent.getByRole("link")).toHaveAttribute("href", /[?&]agent=/);

    // The sub-agent's task notification: summary and status on one row.
    const notification = page.getByRole("article", { name: /Agent "rewrite ranking" finished/ });
    await expect(notification).toBeVisible();
    await expect(notification).toContainText("completed");
  });

  test("pages a long transcript, and a deep link opens the page holding its message", async ({ page }) => {
    // A Search result links to the message with no page: the server finds it.
    await page.goto(`/search?q=${encodeURIComponent("quarterly heatmap")}`);
    const deepLink = await page.getByRole("link", { name: /heatmap export/ }).getAttribute("href");
    expect(deepLink).toMatch(/[?&]msg=/);
    expect(deepLink).not.toMatch(/[?&]page=/);

    await page.getByRole("link", { name: LONG_TITLE, exact: true }).click();
    await page.waitForURL((url) => url.pathname.startsWith("/conversation/"));
    // Role locators skip the hidden Search page the router keeps around.
    const pageTwoPrompt = page.getByRole("main").getByRole("article").filter({ hasText: PAGE_TWO_TEXT });
    const pager = page.getByRole("navigation", { name: "Transcript pages" });
    await expect(pager).toContainText("1–200 of 450 messages");
    await expect(pageTwoPrompt).toHaveCount(0);

    await pager.getByRole("link", { name: "Next" }).click();
    await page.waitForURL((url) => url.searchParams.get("page") === "2");
    await expect(pager).toContainText("201–400 of 450 messages");
    await expect(pageTwoPrompt).toBeVisible();

    // Following that link lands on page 2, the prompt highlighted and scrolled to.
    await page.goto(`/search?q=${encodeURIComponent("quarterly heatmap")}`);
    await page.getByRole("link", { name: /heatmap export/ }).click();
    await page.waitForURL((url) => url.searchParams.has("msg"));
    await expect(pager).toContainText("201–400 of 450 messages");
    await expect(pageTwoPrompt).toHaveClass(/\banchored\b/);
    await expect(pageTwoPrompt).toBeInViewport();
  });

  test("renders the not-found page for an unknown session id", async ({ page }) => {
    await page.goto("/conversation/no-such-session");
    await expect(page.getByRole("heading", { level: 1, name: "Page not found" })).toBeVisible();
    await expect(page).toHaveTitle("Not found · Claude Conversation Analyzer");
  });

  test("renders the not-found page for an unknown URL", async ({ page }) => {
    await page.goto("/nothing-here");
    await expect(page.getByRole("heading", { level: 1, name: "Page not found" })).toBeVisible();
    await expect(page).toHaveTitle("Not found · Claude Conversation Analyzer");
  });
});
