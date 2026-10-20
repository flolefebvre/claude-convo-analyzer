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
// The seeded Conversation every Turn of which is recorded, with one Side request of each kind.
const RECORDED_TITLE = "Add an audit trail to the billing exports";
// The seeded Conversation with an ExitPlanMode call, then a SendMessage call (issue #149).
const PLAN_HANDOFF_TITLE = "Hand the search plan to the docs team";

const titleLink = (page: Page) => page.getByRole("link", { name: TITLE, exact: true });

/** Open the seeded Conversation titled `title` from the Conversations list. */
async function openConversation(page: Page, title: string): Promise<void> {
  await page.goto("/");
  await page.getByRole("link", { name: title, exact: true }).click();
  await page.waitForURL((url) => url.pathname.startsWith("/conversation/"));
}

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

  test("lists the recorded Conversation's Side requests beside its Agents, each opening what it sent", async ({
    page,
  }) => {
    await openConversation(page, RECORDED_TITLE);

    const sideRequests = page.getByRole("navigation", { name: "Side requests" });
    await expect(page.getByTitle(/^Requests Claude Code makes on its own/).first()).toBeVisible();
    await expect(sideRequests.getByRole("link")).toHaveCount(6);

    await sideRequests.getByRole("link", { name: /^Session naming/ }).click();
    await page.waitForURL((url) => url.searchParams.has("sideRequest"));
    await expect(sideRequests.getByRole("link", { name: /^Session naming/ })).toHaveAttribute("aria-current", "page");
    // The "What was sent" panel opens on its own and reads what the Side request sent.
    const whatWasSent = page.getByRole("main").getByRole("group").filter({ hasText: "What was sent" });
    await expect(whatWasSent).toHaveAttribute("open", "");
    await expect(whatWasSent.getByText(/every message is new/)).toBeVisible();
    await expect(whatWasSent.getByText(/max_tokens 512/)).toBeVisible();

    // Another Side request reads its own: the safety monitor sends `max_tokens: 256`.
    await sideRequests.getByRole("link", { name: /^Safety monitor/ }).click();
    await expect(sideRequests.getByRole("link", { name: /^Safety monitor/ })).toHaveAttribute("aria-current", "page");
    await expect(whatWasSent).toHaveAttribute("open", "");
    await expect(whatWasSent.getByText(/max_tokens 256/)).toBeVisible();
    await expect(whatWasSent.getByText(/max_tokens 512/)).toHaveCount(0);
  });

  test("shows no Side requests for an unrecorded Conversation", async ({ page }) => {
    await openConversation(page, TITLE);

    await expect(page.getByRole("navigation", { name: "Agents" })).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Side requests" })).toHaveCount(0);
  });

  test("renders the messages agents send each other, and their task notifications", async ({ page }) => {
    await openConversation(page, AGENT_MESSAGES_TITLE);

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

  test("ships a collapsed tool call's summary, and fetches its body when opened", async ({ page }) => {
    await page.goto("/");
    await titleLink(page).click();
    await page.waitForURL((url) => url.pathname.startsWith("/conversation/"));
    const main = page.getByRole("main");
    // Every seeded result that is not an error begins with this line.
    const resultText = main.getByText(/export function handler/);
    await expect(main.getByRole("heading", { level: 1, name: TITLE })).toBeVisible();
    await expect(resultText).toHaveCount(0);

    // A Tool call that succeeded: its summary carries the result size.
    const size = page.getByText(/^[\d,]+ chars$/);
    const call = main.getByRole("group").filter({ has: size }).first();
    await call.locator(size).click();
    await expect(call.getByText(/export function handler/)).toBeVisible();
    await expect(call.getByText("Input", { exact: true })).toBeVisible();
  });

  test("an opened Agent call shows its Task prompt and its hand-back as markdown, and Raw shows the stored JSON", async ({
    page,
  }) => {
    await openConversation(page, AGENT_MESSAGES_TITLE);

    // The seeded Plan spawn (its type pinned in `agentMessagesConversation`):
    // collapsed, its summary shows its description.
    const call = page.getByRole("main").getByRole("group").filter({ hasText: "plan the change" }).first();
    await call.getByText("plan the change").click();
    const prompt = call.getByRole("group", { name: "Prompt" });
    const returned = call.getByRole("group", { name: "Returned" });

    await expect(prompt.getByRole("term").filter({ hasText: "subagent_type" })).toBeVisible();
    await expect(prompt.getByRole("heading", { level: 2, name: "Constraints" })).toBeVisible();
    await expect(prompt.getByRole("listitem").filter({ hasText: "one commit per slice" })).toBeVisible();

    await expect(returned.getByRole("term").filter({ hasText: "tool uses" })).toBeVisible();
    await expect(returned.getByRole("heading", { level: 2, name: "Plan" })).toBeVisible();
    await expect(returned.getByRole("listitem").filter({ hasText: "add the new scorer behind a flag" })).toBeVisible();

    await prompt.getByRole("button", { name: "Raw" }).click();
    await expect(prompt.getByText(/"prompt": "## Task\\n\\nDraft/)).toBeVisible();
    await expect(prompt.getByRole("heading", { name: "Constraints" })).toHaveCount(0);

    await returned.getByRole("button", { name: "Raw" }).click();
    await expect(returned.getByText(/"status": "completed"/)).toBeVisible();
    await expect(returned.getByRole("heading", { name: "Plan" })).toHaveCount(0);
  });

  test("an opened SendMessage call shows its facts and its message as markdown, and Raw shows the stored JSON", async ({
    page,
  }) => {
    await openConversation(page, PLAN_HANDOFF_TITLE);

    const call = page.getByRole("main").getByRole("group").filter({ hasText: "SendMessage" }).first();
    await call.getByText("SendMessage").click();
    const input = call.getByRole("group", { name: "Input" });
    const result = call.getByRole("group", { name: "Result" });

    await expect(input.getByRole("term").filter({ hasText: "summary" })).toBeVisible();
    await expect(input.getByRole("definition").filter({ hasText: "Search API is ready" })).toBeVisible();
    await expect(input.getByRole("heading", { level: 2, name: "Search API is ready" })).toBeVisible();
    await expect(input.getByRole("listitem").filter({ hasText: "docs freeze still Friday" })).toBeVisible();

    await expect(result.getByRole("term").filter({ hasText: "msg_id" })).toBeVisible();
    await expect(result.getByRole("definition").filter({ hasText: "true" })).toBeVisible();

    await result.getByRole("button", { name: "Raw" }).click();
    await expect(result.getByText(/"success": true/)).toBeVisible();
    await expect(result.getByRole("term")).toHaveCount(0);
  });

  test("a Sub-agent's Task prompt renders as markdown, and a person's Prompt stays plain", async ({ page }) => {
    await openConversation(page, AGENT_MESSAGES_TITLE);

    const humanPrompt = page.getByRole("main").getByRole("article").filter({ hasText: "Pick up where we left off" });
    await expect(humanPrompt).toHaveAccessibleName(/^You /);
    await expect(humanPrompt.getByRole("heading")).toHaveCount(0);
    await expect(humanPrompt.getByRole("paragraph")).toHaveCount(0);

    // The seeded Plan sub-agent (its type pinned in `agentMessagesConversation`)
    // opens with its markdown Task prompt.
    await page.getByRole("navigation", { name: "Agents" }).getByRole("link").filter({ hasText: "Plan" }).click();
    await page.waitForURL((url) => url.searchParams.has("agent"));
    const taskPrompt = page.getByRole("main").getByRole("article").filter({ hasText: "Draft the implementation plan" });
    await expect(taskPrompt).toHaveAccessibleName(/^From /);
    await expect(taskPrompt.getByRole("heading", { level: 2, name: "Constraints" })).toBeVisible();
    await expect(taskPrompt.getByRole("listitem").filter({ hasText: "one commit per slice" })).toBeVisible();
    await expect(taskPrompt.getByRole("code").filter({ hasText: 'export { handler } from "./server";' })).toBeVisible();
  });

  test("a Tools-page link lands on its call open, with the body already there", async ({ page }) => {
    const bodyRequests: string[] = [];
    page.on("request", (request) => {
      if (new URL(request.url()).pathname.startsWith("/api/tool-call/")) bodyRequests.push(request.url());
    });

    await page.goto("/tools?range=all&expanded=Bash");
    const largest = page.locator("section").filter({ has: page.getByRole("heading", { name: "Largest results" }) });
    const link = largest.getByRole("link").first();
    const href = await link.getAttribute("href");
    expect(href).toMatch(/[?&]call=.*#call-/);
    await link.click();
    await page.waitForURL((url) => url.searchParams.has("call"));

    const anchored = page.locator(`[id="${href!.split("#")[1]}"]`);
    await expect(anchored).toHaveAttribute("open", "");
    await expect(anchored).toHaveClass(/\banchored\b/);
    await expect(anchored.getByText(/export function handler/)).toBeVisible();
    await expect(anchored).toBeInViewport();
    expect(bodyRequests).toEqual([]);
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
