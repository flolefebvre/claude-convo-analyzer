import { instant } from "@next/playwright";
import { expect, test, type Locator, type Page } from "@playwright/test";

import { type RouteShell, expectData, expectInstantLoad, expectShell } from "./route-shell";

// A seeded conversation title (`scripts/seed/fake-logs.ts`).
const TITLE = "Split the billing service out of the monolith";
// The seeded conversation where agents message each other (issue #96).
const AGENT_MESSAGES_TITLE = "Coordinate the search rewrite across agents";
// The seeded conversation spanning three Transcript pages, and a prompt on its second (issue #82).
const LONG_TITLE = "Port every report to the new rendering engine";
const PAGE_TWO_TEXT = "Now port the quarterly heatmap export the same way.";
// The seeded Conversation whose log records its API requests (issue #216).
const LOGGED_REQUESTS_TITLE = "Trace the slow invoice query";
// What the thinking of its first Main-thread and first Sub-agent Turns left (issue #215).
const LOGGED_REQUESTS_THINKING_TEXT =
  "Eight seconds on a list suggests a missing index or an N+1. Checking the query plan before reading the code.";
const LOGGED_REQUESTS_SUB_AGENT_THINKING_TEXT =
  "The invoice queries live under src/invoices/. Reading the list query first.";
// The seeded Conversation with an ExitPlanMode call, then a SendMessage call (issue #149).
const PLAN_HANDOFF_TITLE = "Hand the search plan to the docs team";

// The seeded Conversation whose general-purpose Sub-agent forks twice from one Turn, and whose Main thread
// forks too (`forkedAgentsConversation` in `scripts/seed/fake-logs.ts`).
const FORKED_AGENTS_TITLE = "Audit last week's pipeline runs with forked agents";

// A seeded continuation of TITLE, whose copied history TITLE owns (`continuationFamilies` in `scripts/seed/fake-logs.ts`).
const CONTINUATION_TITLE = "Billing split — extract the invoice writer";
// A seeded continuation whose `subagents/` links to its parent's two Explore Sub-agents, and that parent
// (`continuationFamilies` in `scripts/seed/fake-logs.ts`).
const LINKING_CONTINUATION_TITLE = "Nightly export — finish the retry path";
const LINKED_PARENT_TITLE = "Make the nightly export idempotent";

const titleLink = (page: Page) => page.getByRole("link", { name: TITLE, exact: true });

/** The Transcript's disclosures — Tool calls, What was sent, Thinking — not the Replies around them, which hold Turns. */
const disclosures = (page: Page) =>
  page
    .getByRole("main")
    .getByRole("group")
    .filter({ hasNot: page.getByRole("article") });
/** Each Turn whose marker line offers What was sent, in Transcript order. */
const turnsWithWhatWasSent = (page: Page) =>
  page
    .getByRole("main")
    .getByRole("article")
    .filter({ has: page.getByRole("button", { name: "What was sent", exact: true }) });

/** Open `turn`'s What was sent from its marker line, and return the panel it opened under the Turn. */
async function openWhatWasSent(turn: Locator): Promise<Locator> {
  await turn.getByRole("button", { name: "What was sent", exact: true }).click();
  return turn.getByRole("group", { name: "What was sent", exact: true });
}
/** The copied-from markers of the Transcript's rows and Turns. */
const copiedMarkers = (page: Page) => page.getByRole("main").getByText(/^copied from /);

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

  test("is instant on a continuation, then marks its copied history with its owner, linked to that Message", async ({
    page,
    baseURL,
  }) => {
    await page.goto("/");
    const path = await page.getByRole("link", { name: CONTINUATION_TITLE, exact: true }).getAttribute("href");
    const ownerPathname = new URL((await titleLink(page).getAttribute("href"))!, baseURL).pathname;
    // In a copied-from marker, not the family banner above the transcript, which links the parent too.
    const ownerLinks = (p: Page) => copiedMarkers(p).getByRole("link", { name: TITLE, exact: true });
    await expectInstantLoad(page, baseURL, path!, {
      ...conversation,
      data: (p) => [p.getByRole("heading", { level: 1, name: CONTINUATION_TITLE }), ownerLinks(p)],
    });

    // The last Reply copied, far below the top of its owner's Transcript.
    const ownerLink = ownerLinks(page).last();
    await expect(ownerLink.locator("..")).toHaveText(`copied from ${TITLE}`);
    const href = (await ownerLink.getAttribute("href"))!;
    expect(href.startsWith(`${ownerPathname}?msg=`)).toBe(true);
    const messageUuid = new URL(href, baseURL).searchParams.get("msg")!;
    expect(href.endsWith(`#msg-${messageUuid}`)).toBe(true);

    await ownerLink.click();
    await page.waitForURL((url) => url.pathname === ownerPathname);
    // The router keeps the continuation it came from around, hidden, with the same uuid.
    const ownerMessage = page.locator(`article[id="msg-${messageUuid}"]`).filter({ visible: true });
    await expect(ownerMessage).toHaveClass(/\banchored\b/);
    await expect(ownerMessage).toBeInViewport();
  });

  test("shows a continuation's linked Sub-agents under its Main thread, every row copied from the parent that ran them", async ({
    page,
    baseURL,
  }) => {
    await page.goto("/");
    const parentHref = await page.getByRole("link", { name: LINKED_PARENT_TITLE, exact: true }).getAttribute("href");
    const parentPathname = new URL(parentHref!, baseURL).pathname;
    await openConversation(page, LINKING_CONTINUATION_TITLE);
    const agents = page.getByRole("navigation", { name: "Agents" });
    for (const name of ["Explore #1", "Explore #2"])
      await expect(agents.getByTitle(name, { exact: true })).toHaveAttribute("style", /--depth:\s*1\b/);

    await agents.getByTitle("Explore #1", { exact: true }).click();
    await page.waitForURL((url) => url.searchParams.has("agent"));
    // Each Message addressed to it, and each Reply as a whole, wholly copied: its Turns carry no marker of their own.
    const main = page.getByRole("main");
    const addressedMessages = main.getByRole("article", { name: /^(?!Turn \d)/ });
    const replies = main.getByRole("group", { name: /^Explore #1 \d+ turns? · / });
    const ownerLinks = copiedMarkers(page).getByRole("link", { name: LINKED_PARENT_TITLE, exact: true });
    await expect(replies.first()).toBeVisible();
    await expect(ownerLinks).toHaveCount((await addressedMessages.count()) + (await replies.count()));
    await expect(main.getByRole("article", { name: /^Turn \d/ }).filter({ hasText: /\$\d/ })).toHaveCount(0);
    // Each names the parent's own Sub-agent, the Message's owner.
    const agentId = new URL(page.url()).searchParams.get("agent")!;
    await expect(ownerLinks.first()).toHaveAttribute("href", new RegExp(`^${parentPathname}\\?agent=${agentId}&`));
  });

  test("nests a Sub-agent's forks under it, their copied rows marked from it and their own Turns costed", async ({
    page,
  }) => {
    await openConversation(page, FORKED_AGENTS_TITLE);
    const agents = page.getByRole("navigation", { name: "Agents" });
    // The lead under the Main thread, its two forks under it, and the Main thread's own fork beside it.
    await expect(agents.getByTitle("general-purpose", { exact: true })).toHaveAttribute("style", /--depth:\s*1\b/);
    await expect(agents.getByTitle("fork #1", { exact: true })).toHaveAttribute("style", /--depth:\s*2\b/);
    await expect(agents.getByTitle("fork #2", { exact: true })).toHaveAttribute("style", /--depth:\s*2\b/);
    await expect(agents.getByTitle("fork", { exact: true })).toHaveAttribute("style", /--depth:\s*1\b/);

    await agents.getByTitle("fork #1", { exact: true }).click();
    await page.waitForURL((url) => url.searchParams.has("agent"));
    const rows = page.getByRole("main").getByRole("article");
    const copiedMarker = page.getByTitle("Copied from general-purpose", { exact: true });
    // The lead's prompt, then, in a partly copied Reply, its first Turn and its spawning Turn re-written: each
    // marked from the lead on its own header or marker line, linked to it.
    const copiedRows = rows.filter({ has: copiedMarker });
    await expect(copiedRows).toHaveCount(3);
    await expect(copiedRows.first().getByRole("link", { name: "general-purpose", exact: true })).toHaveAttribute(
      "href",
      /[?&]agent=/,
    );
    // Its own Turns: each shows what it cost.
    const ownTurns = page
      .getByRole("main")
      .getByRole("article", { name: /^Turn \d/ })
      .filter({ hasNot: copiedMarker });
    await expect(ownTurns).toHaveCount(2);
    for (const turn of await ownTurns.all()) await expect(turn).toContainText(/\$\d+\.\d{2,4}/);
  });

  test("links each Agent call of a Turn that forks twice to its own fork", async ({ page }) => {
    await openConversation(page, FORKED_AGENTS_TITLE);
    const agents = page.getByRole("navigation", { name: "Agents" });
    await agents.getByTitle("general-purpose", { exact: true }).click();
    await page.waitForURL((url) => url.searchParams.has("agent"));

    // The lead's forking Turn: its two calls, each named after the fork it spawned and opening that fork.
    const forkCalls = page
      .getByRole("main")
      .getByRole("group")
      .filter({ hasText: /^Agentfork #\d/ });
    await expect(forkCalls).toHaveCount(2);
    const forkNames: string[] = [];
    for (const call of await forkCalls.all()) {
      const forkName = (await call.textContent())!.match(/fork #\d/)![0];
      forkNames.push(forkName);
      // Its summary: the body holds the description too.
      await call
        .getByText(/^Audit \w+'s failed run$/)
        .first()
        .click();
      const forkHref = await agents.getByTitle(forkName, { exact: true }).getAttribute("href");
      await expect(call.getByRole("link", { name: "Open transcript" })).toHaveAttribute("href", forkHref!);
    }
    expect(forkNames.sort()).toEqual(["fork #1", "fork #2"]);
  });

  test("publishes the chrome's measured height, which the agent tree fits under", async ({ page }) => {
    await openConversation(page, TITLE);

    // The seed has no outdated Conversation, so the chrome is the app bar alone.
    const appBarHeight = (await page.getByRole("banner").boundingBox())!.height;
    await expect
      .poll(() => page.evaluate(() => document.documentElement.style.getPropertyValue("--chrome-height")))
      .toBe(`${appBarHeight}px`);
  });

  test("shows an Agent's first request in reading order, with no tabs, and swaps it for its raw JSON", async ({
    page,
  }) => {
    await openConversation(page, LOGGED_REQUESTS_TITLE);
    const reads: string[] = [];
    page.on("request", (request) => {
      if (new URL(request.url()).pathname.startsWith("/api/api-request/")) reads.push(request.url());
    });
    const turn = turnsWithWhatWasSent(page).first();
    const trigger = turn.getByRole("button", { name: "What was sent", exact: true });
    await expect(trigger).toHaveAttribute("aria-expanded", "false");
    const whatWasSent = await openWhatWasSent(turn);
    await expect(trigger).toHaveAttribute("aria-expanded", "true");
    await expect(trigger).toHaveAttribute("aria-controls", (await whatWasSent.getAttribute("id"))!);

    await expect(
      whatWasSent.getByText(
        /^claude-\S+ · effort high · max 32K tokens · thinking \(adaptive · display updates\) · 3 cache breakpoints · 2 betas · sent \d{2}:\d{2}$/,
      ),
    ).toBeVisible();
    await expect(whatWasSent.getByText("First request of this Agent", { exact: true })).toBeVisible();
    await expect(whatWasSent.getByRole("heading", { name: "New for this Turn" })).toBeVisible();
    // The environment, the skill list and the date Claude Code fused into one system message, a row each;
    // then the CLAUDE.md and AGENTS.md it injected before the prompt, named by their files.
    const rowNamed = (label: RegExp) => whatWasSent.getByRole("group").filter({ hasText: label });
    await expect(rowNamed(/^Environment/)).toContainText("# Environment");
    await expect(rowNamed(/^Skill list/)).toContainText("The following skills are available");
    await expect(rowNamed(/^Date/)).toContainText("Today's date is");
    const instructions = rowNamed(/^CLAUDE\.md · AGENTS\.md/);
    await expect(instructions).toContainText("As you answer the user's questions");
    await expect(rowNamed(/^Prompt/)).toContainText("The invoice list takes eight seconds to load");
    await instructions.getByText("CLAUDE.md · AGENTS.md").click();
    await expect(instructions.getByText(/# claudeMd/)).toBeVisible();
    await expect(whatWasSent.getByRole("tab")).toHaveCount(0);
    await expect(whatWasSent.getByText(/Changes/)).toHaveCount(0);

    const rawToggle = whatWasSent.getByRole("button", { name: "Raw JSON" });
    await rawToggle.click();
    await expect(rawToggle).toHaveAttribute("aria-pressed", "true");
    await expect(whatWasSent.getByText(/^Rebuilt from the conversation log/)).toBeVisible();
    await expect(whatWasSent.getByText("model:", { exact: true })).toBeVisible();
    await expect(whatWasSent.getByRole("button", { name: "Copy JSON" })).toBeVisible();
    await expect(whatWasSent.getByRole("heading", { name: "New for this Turn" })).toHaveCount(0);

    await rawToggle.click();
    await expect(whatWasSent.getByRole("heading", { name: "New for this Turn" })).toBeVisible();

    // The trigger closes it again; reopened, it shows what it read, reading nothing again.
    await trigger.click();
    await expect(trigger).toHaveAttribute("aria-expanded", "false");
    await expect(whatWasSent).toBeHidden();
    await trigger.click();
    await expect(whatWasSent.getByRole("heading", { name: "New for this Turn" })).toBeVisible();
    expect(reads.filter((url) => !url.endsWith("/raw"))).toHaveLength(1);
  });

  test("offers What was sent only on a Turn whose API request the logs hold", async ({ page }) => {
    await openConversation(page, TITLE);
    await expect(page.getByRole("main").getByRole("article", { name: /^Turn 1\b/ })).toBeVisible();
    await expect(page.getByRole("main").getByRole("button", { name: "What was sent" })).toHaveCount(0);
  });

  test("shows what a later Turn sent: the system prompt's real change and its diff, the tools added, and the new messages", async ({
    page,
  }) => {
    await openConversation(page, LOGGED_REQUESTS_TITLE);

    // The third Turn: the day after, its system prompt changed and Grep was loaded.
    const whatWasSent = await openWhatWasSent(turnsWithWhatWasSent(page).nth(2));

    const systemPrompt = whatWasSent.getByRole("group").filter({ hasText: /^System prompt/ });
    await expect(systemPrompt.getByText(/^2 blocks · [\d.]+ (?:B|KB)$/)).toBeVisible();
    await expect(systemPrompt.getByText("changed since previous request", { exact: true })).toBeVisible();
    await expect(systemPrompt.getByText(/volatile only/)).toHaveCount(0);
    await systemPrompt.getByText("System prompt").click();
    await expect(systemPrompt.getByText(/^Run the query planner before changing an index\./m)).toBeVisible();
    await expect(systemPrompt.getByText("Cache breakpoint: ephemeral 1h")).toBeVisible();
    await systemPrompt.getByRole("button", { name: "Diff" }).click();
    await expect(systemPrompt.getByText("+ Run the query planner before changing an index.")).toBeVisible();

    const tools = whatWasSent.getByRole("group").filter({ hasText: /^Tools/ });
    await expect(tools.getByText("+1 since previous: Grep", { exact: true })).toBeVisible();
    await tools.getByText("Tools", { exact: true }).click();
    await tools.getByText("Grep", { exact: true }).click();
    await expect(tools.getByText(/"description": "Search file contents\."/)).toBeVisible();

    // The previous request sent four messages; this one adds the previous Turn, the date change and the prompt.
    await expect(
      whatWasSent.getByText("4 earlier messages · already sent with the previous request", { exact: true }),
    ).toBeVisible();
    await expect(whatWasSent.getByRole("group").filter({ hasText: /^Date/ })).toContainText(
      /The date has changed\. Today's date is now/,
    );
    await expect(whatWasSent.getByRole("group").filter({ hasText: /^Prompt/ })).toContainText(
      "Now check the date filter on the same query.",
    );
    await expect(whatWasSent.getByText(/could not be rebuilt/)).toHaveCount(0);
  });

  test("shows the Failed attempts a Turn's log records: how many, and the time they lost, with no status", async ({
    page,
  }) => {
    await openConversation(page, LOGGED_REQUESTS_TITLE);

    // The second Turn went through on a retry, 300 ms after its one Failed attempt: its marker line says so.
    const turn = page.getByRole("main").getByRole("article", { name: /^Turn 2\b/ });
    await expect(turn.getByText("1 failed attempt · 300ms lost", { exact: true })).toBeVisible();
    await expect(page.getByRole("main").getByText(/failed attempt/)).toHaveCount(1);

    const whatWasSent = await openWhatWasSent(turn);
    await expect(whatWasSent.getByRole("heading", { name: "1 failed attempt before this request" })).toBeVisible();
    await expect(whatWasSent.getByText("lost 300ms", { exact: true })).toBeVisible();
    await expect(whatWasSent.getByText(/no error message/)).toHaveCount(0);
  });

  test("shows a Turn's thinking before its text: opening to its summary, or a plain line without one, in every Agent", async ({
    page,
  }) => {
    /** In the open transcript, the line `openable` opens to `summary`, and the line `plain` offers nothing to open. */
    const expectThinkingLines = async (openable: string, summary: string, plain: string) => {
      const transcript = page.getByRole("main");
      const thinking = transcript.getByRole("group").filter({ hasText: new RegExp(`^${openable}`) });
      await expect(thinking.getByText(summary)).toBeHidden();
      await thinking.getByText(openable, { exact: true }).click();
      await expect(thinking.getByText(summary, { exact: true })).toBeVisible();
      await expect(transcript.getByText(plain, { exact: true })).toBeVisible();
      await expect(transcript.getByRole("group").filter({ hasText: new RegExp(`^${plain}`) })).toHaveCount(0);
    };

    await openConversation(page, LOGGED_REQUESTS_TITLE);
    await expectThinkingLines("Thinking · 1.3s", LOGGED_REQUESTS_THINKING_TEXT, "Thinking · 600ms");

    await page.getByRole("navigation", { name: "Agents" }).getByRole("link").filter({ hasText: "Explore" }).click();
    await page.waitForURL((url) => url.searchParams.has("agent"));
    await expectThinkingLines("Thinking · 2.4s", LOGGED_REQUESTS_SUB_AGENT_THINKING_TEXT, "Thinking · 450ms");
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
    const call = disclosures(page).filter({ has: size }).first();
    // A call that is neither an Agent call nor a skill load carries no kind chip.
    await expect(call.getByText("Tool", { exact: true })).toHaveCount(0);
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
    const call = disclosures(page).filter({ hasText: "plan the change" }).first();
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

    const call = disclosures(page).filter({ hasText: "SendMessage" }).first();
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
