// The Transcript filter (GLOSSARY.md): the Show section in the agent tree. The
// choice lives in the seeded settings file, which every open page reads, so
// `playwright.config.ts` runs this file in its `shared-state` project, after
// every other spec, never beside an `instant()` scope; each test puts the
// filter back to Everything.

import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { expect, test, type Locator, type Page } from "@playwright/test";

import { openConversation } from "./open-conversation";

// The seeded settings file the e2e server reads (`scripts/dev-seed/serve-seeded.ts`).
const SEEDED_SETTINGS_PATH = path.join("data", "seed", "settings.json");

// The seeded Conversation whose log records its API requests: four Main-thread Turns, the first calling Explore,
// the third Grep (`loggedRequestsConversation` in `scripts/seed/fake-logs.ts`).
const LOGGED_REQUESTS_TITLE = "Trace the slow invoice query";
// What the thinking of its first Main-thread Turn left.
const LOGGED_REQUESTS_THINKING_TEXT =
  "Eight seconds on a list suggests a missing index or an N+1. Checking the query plan before reading the code.";
// Its continuation, whose four copied Turns name their owner's API requests (`loggedRequestsContinuation`).
const LOGGED_REQUESTS_CONTINUATION_TITLE = "Trace the slow invoice query — fix the date filter";
// The seeded Conversation where agents message each other, with three Task notifications (issue #96).
const AGENT_MESSAGES_TITLE = "Coordinate the search rewrite across agents";

const showSection = (page: Page) => page.getByRole("group", { name: "Show in the transcript" });
/** The Show section's toggle for `kind`, named by its label and its count. */
const kindToggle = (page: Page, kind: string) =>
  showSection(page).getByRole("button", { name: new RegExp(`^${kind} [\\d,]+$`) });
const turnNamed = (page: Page, turn: string) =>
  page.getByRole("main").getByRole("article", { name: new RegExp(`^${turn}\\b`) });
const foldLine = (scope: Page | Locator, label: string) => scope.getByRole("button", { name: label, exact: true });

test.describe("Transcript filter", () => {
  test.describe.configure({ mode: "serial" });

  test.afterEach(() => {
    const settings = JSON.parse(readFileSync(SEEDED_SETTINGS_PATH, "utf8")) as Record<string, unknown>;
    settings.transcriptFilter = {
      toolCalls: true,
      thinking: true,
      whatWasSent: true,
      interAgentMessages: true,
      taskNotifications: true,
    };
    writeFileSync(SEEDED_SETTINGS_PATH, `${JSON.stringify(settings, null, 2)}\n`);
  });

  test("hides Tool calls behind a line counting them, at once and in place, and reveals them there", async ({
    page,
  }) => {
    await openConversation(page, LOGGED_REQUESTS_TITLE);
    const firstTurn = turnNamed(page, "Turn 1");
    const agentCall = firstTurn.getByText("locate the behaviour");
    await expect(agentCall).toBeVisible();
    const url = page.url();
    // A navigation would drop it: a toggle re-renders the page in place.
    await page.evaluate(() => Object.assign(window, { notNavigated: true }));

    await kindToggle(page, "Tool calls").click();
    await expect(kindToggle(page, "Tool calls")).toHaveAttribute("aria-pressed", "false");
    await expect(foldLine(firstTurn, "1 tool call hidden · show")).toBeVisible();
    await expect(agentCall).toHaveCount(0);
    expect(page.url()).toBe(url);
    expect(await page.evaluate(() => "notNavigated" in window)).toBe(true);
    // The Reply's header still counts what it holds, and the hidden Turn's neighbour keeps its number.
    await expect(
      page
        .getByRole("main")
        .getByRole("group", { name: /^Assistant 2 turns · 1 tool call$/ })
        .first(),
    ).toBeVisible();
    await expect(turnNamed(page, "Turn 2")).toBeVisible();

    await foldLine(firstTurn, "1 tool call hidden · show").click();
    const hideLine = foldLine(firstTurn, "1 tool call · hide");
    await expect(hideLine).toHaveAttribute("aria-expanded", "true");
    await expect(agentCall).toBeVisible();
    // Only that spot: the third Turn's call stays folded.
    await expect(foldLine(turnNamed(page, "Turn 3"), "1 tool call hidden · show")).toBeVisible();

    await hideLine.click();
    await expect(agentCall).toHaveCount(0);
    await expect(foldLine(firstTurn, "1 tool call hidden · show")).toBeVisible();
  });

  test("keeps the choice across Agents and Transcripts, each Agent showing its own counts", async ({ page }) => {
    await openConversation(page, LOGGED_REQUESTS_TITLE);
    await expect(kindToggle(page, "Tool calls")).toHaveAccessibleName("Tool calls 2");
    await kindToggle(page, "Thinking").click();
    await expect(page.getByRole("main").getByText("Thinking · 1.3s")).toHaveCount(0);

    await page.getByRole("navigation", { name: "Agents" }).getByTitle("Explore", { exact: true }).click();
    await page.waitForURL((url) => url.searchParams.has("agent"));
    await expect(kindToggle(page, "Tool calls")).toHaveAccessibleName("Tool calls 1");
    await expect(kindToggle(page, "Thinking")).toHaveAttribute("aria-pressed", "false");
    await expect(page.getByRole("main").getByText(/^Thinking · /)).toHaveCount(0);

    await openConversation(page, AGENT_MESSAGES_TITLE);
    await expect(kindToggle(page, "Thinking")).toHaveAttribute("aria-pressed", "false");
    await page.reload();
    await expect(kindToggle(page, "Thinking")).toHaveAttribute("aria-pressed", "false");
  });

  test("folds each hidden Task notification into its own line under Messages only, keeping Inter-agent messages", async ({
    page,
  }) => {
    await openConversation(page, AGENT_MESSAGES_TITLE);
    await page.getByRole("button", { name: "Messages only", exact: true }).click();
    await expect(page.getByRole("button", { name: "Messages only", exact: true })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    for (const kind of ["Tool calls", "Thinking", "What was sent", "Task notifications"])
      await expect(kindToggle(page, kind)).toHaveAttribute("aria-pressed", "false");
    await expect(kindToggle(page, "Inter-agent messages")).toHaveAttribute("aria-pressed", "true");

    const notificationLines = foldLine(page.getByRole("main"), "Task notification hidden · show");
    await expect(notificationLines).toHaveCount(3);
    await expect(page.getByRole("main").getByText("From general-purpose").first()).toBeVisible();
    await notificationLines.first().click();
    await expect(foldLine(page.getByRole("main"), "Task notification · hide")).toBeVisible();
    await expect(notificationLines).toHaveCount(2);

    // A new choice clears every reveal.
    await kindToggle(page, "Thinking").click();
    await expect(kindToggle(page, "Thinking")).toHaveAttribute("aria-pressed", "true");
    await expect(notificationLines).toHaveCount(3);
  });

  test("lands a `?call=` deep link on its Tool call revealed, though Tool calls are hidden", async ({
    page,
    baseURL,
  }) => {
    await openConversation(page, LOGGED_REQUESTS_TITLE);
    const callId = (await turnNamed(page, "Turn 3").locator("[id^='call-']").getAttribute("id"))!;
    await kindToggle(page, "Tool calls").click();
    await expect(foldLine(turnNamed(page, "Turn 3"), "1 tool call hidden · show")).toBeVisible();

    const url = new URL(page.url(), baseURL);
    url.searchParams.set("call", callId.replace(/^call-/, ""));
    url.hash = callId;
    await page.goto(url.toString());
    const thirdTurn = turnNamed(page, "Turn 3");
    await expect(foldLine(thirdTurn, "1 tool call · hide")).toHaveAttribute("aria-expanded", "true");
    await expect(page.locator(`[id="${callId}"]`)).toBeInViewport();
    await expect(foldLine(turnNamed(page, "Turn 1"), "1 tool call hidden · show")).toBeVisible();
  });

  test("leaves the Conversation export whole, whatever it hides", async ({ page }) => {
    await openConversation(page, LOGGED_REQUESTS_TITLE);
    await page.getByRole("button", { name: "Messages only", exact: true }).click();
    await expect(foldLine(turnNamed(page, "Turn 1"), "1 tool call hidden · show")).toBeVisible();

    const sessionId = new URL(page.url()).pathname.split("/").at(-1)!;
    const html = await (await page.request.get(`/api/conversation/${sessionId}/export`)).text();
    expect(html).toContain(LOGGED_REQUESTS_THINKING_TEXT);
    expect(html).toContain("locate the behaviour");
    expect(html).not.toContain("hidden · show");
  });

  test("counts no What was sent for a copied Turn: its owner's Transcript counts it", async ({ page }) => {
    await openConversation(page, LOGGED_REQUESTS_CONTINUATION_TITLE);
    await expect(
      page
        .getByRole("main")
        .getByText(/^copied from /)
        .first(),
    ).toBeVisible();
    await expect(kindToggle(page, "What was sent")).toHaveAccessibleName("What was sent 0");

    await openConversation(page, LOGGED_REQUESTS_TITLE);
    await expect(kindToggle(page, "What was sent")).toHaveAccessibleName("What was sent 4");
  });
});
