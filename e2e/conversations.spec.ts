import os from "node:os";
import path from "node:path";

import { instant } from "@next/playwright";
import { expect, test, type Locator, type Page } from "@playwright/test";

import { type RouteShell, expectData, expectInstantLoad } from "./route-shell";

// A seeded conversation title (`scripts/seed/fake-logs.ts`).
const TITLE = "Split the billing service out of the monolith";

// The seeded Conversation every Turn of which is recorded, then the one recorded only from mid-way.
const RECORDED_TITLE = "Add an audit trail to the billing exports";
const PARTIALLY_RECORDED_TITLE = "Tighten the webhook signature checks";

// The seeded `~/dev/acme-api` repo, a Project with worktree Projects below it.
const REPO = path.join(os.homedir(), "dev", "acme-api");

// A seeded worktree Project of {@link REPO}.
const WORKTREE = path.join(REPO, ".claude", "worktrees", "fix-auth-flake");

// A seeded repo that is no seeded favorite, and that no other test names: the one the Favorites test toggles.
const UNFAVORITED_REPO = path.join(os.homedir(), "dev", "billing-service");

const header = (page: Page) => page.getByRole("heading", { level: 1, name: "Conversations" });
/** A Folder's chevron, in whichever folder tree (desktop sidebar or phone picker) `scope` holds. */
const chevron = (scope: Page | Locator, label: string) =>
  scope.getByRole("button", { name: `${label} sub-folders`, exact: true });
/** A Folder's name link, whose accessible name starts with its label. */
const folderLink = (scope: Locator, label: string) =>
  scope.getByRole("link", { name: new RegExp(`^${label.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")}\\W`) });

/** The sidebar's Favorites section, in whichever folder tree `scope` holds. */
const favoritesList = (scope: Page | Locator) => scope.getByRole("list", { name: "Favorites" });

/** The Favorites section's links, top to bottom. */
const favoriteLinks = (favorites: Locator) => favorites.getByRole("link");

/** The seeded favorites' order, as {@link favoriteLinks} texts start. */
const SEEDED_FAVORITE_ORDER = [/^acme-api/, /^web-dashboard/, /^mobile-app/];

/** Wait until the move made from `grip` is saved: the grip takes moves again. */
const expectSaved = (grip: Locator) => expect(grip).toHaveAttribute("aria-disabled", "false");

/** `locator`'s on-screen box; it must be rendered. */
async function boxOf(locator: Locator) {
  const box = await locator.boundingBox();
  if (box === null) throw new Error(`${locator.toString()} is not rendered`);
  return box;
}

const conversations: RouteShell = {
  shell: (page) => [header(page)],
  fallbacks: (page) => [
    page.getByRole("status", { name: "Loading folders" }),
    page.getByRole("status", { name: "Loading overview" }),
    page.getByRole("status", { name: "Loading conversations" }),
  ],
  data: (page) => [
    page.getByRole("navigation", { name: "Folders" }),
    favoritesList(page),
    chevron(page, "~"),
    page.getByRole("heading", { level: 2, name: /All projects/ }),
    page.getByText(TITLE, { exact: true }),
  ],
};

test.describe("Conversations (/)", () => {
  test("is instant on an initial page load", async ({ page, baseURL }) => {
    await expectInstantLoad(page, baseURL, "/", conversations);
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

test.describe("Recorded marker", () => {
  /** The list row of the seeded Conversation titled `title`. */
  const row = (page: Page, title: string) =>
    page
      .locator("#conversations")
      .getByRole("row")
      .filter({ has: page.getByText(title, { exact: true }) });

  test("marks the recorded and partially recorded Conversations, and leaves an unrecorded one unmarked", async ({
    page,
  }) => {
    await page.goto("/");

    await expect(row(page, RECORDED_TITLE).getByTitle(/^Recorded/)).toBeVisible();
    await expect(row(page, PARTIALLY_RECORDED_TITLE).getByTitle(/^Partially recorded/)).toBeVisible();
    await expect(row(page, TITLE)).toBeVisible();
    await expect(row(page, TITLE).getByTitle(/recorded/i)).toHaveCount(0);
  });

  test("breaks the recorded Conversation's Side requests down by kind in its detail panel", async ({ page }) => {
    await page.goto("/");
    await row(page, RECORDED_TITLE)
      .getByRole("link", { name: /^Expand conversation details/ })
      .click();
    await page.waitForURL((url) => url.searchParams.has("expanded"));

    const heading = page.getByRole("heading", { level: 3, name: "Side requests" });
    await expect(heading.getByTitle(/^Requests Claude Code makes on its own/)).toBeVisible();
    // The section: the heading's own wrapper.
    const section = heading.locator("xpath=..");
    await expect(section.getByText(/^6 Side requests · /)).toBeVisible();
    for (const kind of ["Session naming", "Quota probe", "Safety monitor", "Suggestion", "Token count", "Other"]) {
      await expect(section.getByText(kind, { exact: true })).toBeVisible();
    }
  });
});

test.describe("Folder tree", () => {
  test("opens the ~ and /tmp roots one level, and nests a worktree under its opened repo", async ({ page }) => {
    await page.goto("/");
    const tree = page.getByRole("complementary").getByRole("navigation", { name: "Folders" });

    await expect(chevron(tree, "~")).toHaveAttribute("aria-expanded", "true");
    await expect(chevron(tree, "/tmp")).toHaveAttribute("aria-expanded", "true");
    await expect(folderLink(tree, "dev")).toBeVisible();
    await expect(folderLink(tree, "scratch")).toBeVisible();
    await expect(folderLink(tree, "20260612-091204")).toHaveCount(0);
    await expect(folderLink(tree, "fix-auth-flake")).toHaveCount(0);

    // The chevron only opens: no navigation.
    const before = page.url();
    await chevron(tree, "dev").click();
    await chevron(tree, "acme-api").click();
    await expect(folderLink(tree, "fix-auth-flake")).toHaveCount(0);
    await chevron(tree, ".claude/worktrees").click();
    await expect(folderLink(tree, "fix-auth-flake")).toBeVisible();
    await expect(folderLink(tree, "(this folder)")).toBeVisible();
    expect(page.url()).toBe(before);

    // The name only scopes: the Folder stays as it was.
    await folderLink(tree, ".claude/worktrees").click();
    await page.waitForURL((url) => url.searchParams.get("folder")?.endsWith("/.claude/worktrees") ?? false);
    await expect(chevron(tree, ".claude/worktrees")).toHaveAttribute("aria-expanded", "true");
    await expect(page.getByRole("navigation", { name: "Folder scope" })).toContainText(".claude/worktrees");

    // A scope reached from outside the tree opens its path again, even one the user closed.
    await folderLink(tree, "fix-auth-flake").click();
    await page.waitForURL((url) => url.searchParams.get("folder") === WORKTREE);
    await chevron(tree, "dev").click();
    await expect(folderLink(tree, "fix-auth-flake")).toHaveCount(0);
    await folderLink(tree, "All folders").click();
    await page.waitForURL((url) => !url.searchParams.has("folder"));
    await page.goBack();
    await page.waitForURL((url) => url.searchParams.get("folder") === WORKTREE);
    await expect(folderLink(tree, "fix-auth-flake")).toBeVisible();
    await expect(folderLink(tree, "fix-auth-flake")).toHaveAttribute("aria-current", "true");
  });

  test("a row's Folder scopes the list to exactly its Project, and the tree opens down to it", async ({ page }) => {
    await page.goto(`/?${new URLSearchParams({ sortBy: "cost", dir: "asc", folder: REPO, range: "90" }).toString()}`);
    const tree = page.getByRole("complementary").getByRole("navigation", { name: "Folders" });

    await page
      .locator("#conversations")
      .getByRole("link", { name: ".claude/worktrees/fix-auth-flake", exact: true })
      .first()
      .click();
    await page.waitForURL((url) => url.searchParams.get("folder") === WORKTREE);
    const params = new URL(page.url()).searchParams;
    expect(Object.fromEntries(params)).toEqual({ sortBy: "cost", dir: "asc", folder: WORKTREE, range: "90" });
    await expect(folderLink(tree, "fix-auth-flake")).toHaveAttribute("aria-current", "true");
    await expect(folderLink(tree, "fix-auth-flake")).toBeInViewport();
  });

  test.describe("in a short window", () => {
    test.use({ viewport: { width: 1280, height: 300 } });

    test("a Favorite scrolls its row in the tree, below the window, into view", async ({ page }) => {
      await page.goto("/");
      const tree = page.getByRole("complementary").getByRole("navigation", { name: "Folders" });

      await folderLink(favoritesList(tree), "acme-api").click();
      await page.waitForURL((url) => url.searchParams.get("folder") === REPO);
      // The tree's row, after the Favorites' one; closed under `dev` until the scope opened it.
      const treeRow = folderLink(tree, "acme-api").last();
      await expect(treeRow).toHaveAttribute("aria-current", "true");
      await expect(treeRow).toBeInViewport();
    });
  });

  test.describe("on a phone", () => {
    test.use({ viewport: { width: 390, height: 844 } });

    test("names the selected Folder and opens the same tree down to it", async ({ page }) => {
      await page.goto(`/?${new URLSearchParams({ folder: WORKTREE }).toString()}`);
      const picker = page.locator("details");

      await expect(picker.locator("summary")).toContainText("fix-auth-flake");
      await picker.locator("summary").click();
      const tree = picker.getByRole("navigation", { name: "Folders" });
      await expect(folderLink(tree, "fix-auth-flake")).toHaveAttribute("aria-current", "true");
      await expect(chevron(tree, "acme-api")).toHaveAttribute("aria-expanded", "true");
    });
  });
});

test.describe("Favorites", () => {
  // The toggle writes the seed's settings file: its tests never overlap.
  test.describe.configure({ mode: "serial" });

  test("lists the seeded favorites above All folders, starred in the tree too", async ({ page }) => {
    await page.goto("/");
    const tree = page.getByRole("complementary").getByRole("navigation", { name: "Folders" });
    const favorites = favoritesList(tree);

    await expect(favoriteLinks(favorites)).toHaveText(SEEDED_FAVORITE_ORDER);
    await chevron(tree, "dev").click();
    await expect(tree.getByRole("button", { name: "Favorite acme-api", pressed: true })).toHaveCount(2);
  });

  test("favorites a Folder from its tree row, then unfavorites it from the breadcrumb", async ({ page }) => {
    await page.goto("/");
    const tree = page.getByRole("complementary").getByRole("navigation", { name: "Folders" });
    const favorites = favoritesList(tree);
    await chevron(tree, "dev").click();

    // The star shows on the row's hover, beside its link.
    await folderLink(tree, "billing-service").hover();
    await tree.getByRole("button", { name: "Favorite billing-service", pressed: false }).click();
    await expect(folderLink(favorites, "billing-service")).toBeVisible();
    await expect(tree.getByRole("button", { name: "Favorite billing-service", pressed: true })).toHaveCount(2);

    // A favorite selects its scope, and shows as the active entry.
    await folderLink(favorites, "billing-service").click();
    await page.waitForURL((url) => url.searchParams.get("folder") === UNFAVORITED_REPO);
    await expect(folderLink(favorites, "billing-service")).toHaveAttribute("aria-current", "true");

    const breadcrumb = page.getByRole("navigation", { name: "Folder scope" });
    await breadcrumb.getByRole("button", { name: "Favorite billing-service", pressed: true }).click();
    await expect(folderLink(favorites, "billing-service")).toHaveCount(0);
    await expect(breadcrumb.getByRole("button", { name: "Favorite billing-service", pressed: false })).toBeVisible();
    await expect(tree.getByRole("button", { name: "Favorite billing-service", pressed: false })).toBeVisible();
  });

  test("moves a favorite with Alt+arrows on its grip, announced, and keeps the order across a reload", async ({
    page,
  }) => {
    await page.goto("/");
    const tree = page.getByRole("complementary").getByRole("navigation", { name: "Folders" });
    const favorites = favoritesList(tree);
    const grip = favorites.getByRole("button", { name: "Reorder acme-api" });

    await grip.focus();
    await page.keyboard.press("Alt+ArrowDown");
    await expect(favoriteLinks(favorites)).toHaveText([/^web-dashboard/, /^acme-api/, /^mobile-app/]);
    await expect(tree.getByText("acme-api moved to position 2 of 3")).toBeAttached();
    await expect(grip).toBeFocused();
    await expectSaved(grip);

    await page.reload();
    await expect(favoriteLinks(favorites)).toHaveText([/^web-dashboard/, /^acme-api/, /^mobile-app/]);

    // Back to the seeded order, for the tests after this one.
    await grip.focus();
    await page.keyboard.press("Alt+ArrowUp");
    await expect(favoriteLinks(favorites)).toHaveText(SEEDED_FAVORITE_ORDER);
    await expectSaved(grip);
  });

  test("moves a favorite dragged by its grip, and keeps the order across a reload", async ({ page }) => {
    await page.goto("/");
    const tree = page.getByRole("complementary").getByRole("navigation", { name: "Folders" });
    const favorites = favoritesList(tree);
    const grip = favorites.getByRole("button", { name: "Reorder mobile-app" });

    // Drag the last favorite above the first one's middle.
    await folderLink(favorites, "mobile-app").hover();
    const gripBox = await boxOf(grip);
    const firstRowBox = await boxOf(folderLink(favorites, "acme-api"));
    await page.mouse.move(gripBox.x + gripBox.width / 2, gripBox.y + gripBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(gripBox.x + gripBox.width / 2, firstRowBox.y + 4, { steps: 10 });
    await page.mouse.up();
    await expect(favoriteLinks(favorites)).toHaveText([/^mobile-app/, /^acme-api/, /^web-dashboard/]);
    await expectSaved(grip);

    await page.reload();
    await expect(favoriteLinks(favorites)).toHaveText([/^mobile-app/, /^acme-api/, /^web-dashboard/]);

    // Back to the seeded order, for the tests after this one.
    await grip.focus();
    await page.keyboard.press("Alt+ArrowDown");
    await expect(favoriteLinks(favorites)).toHaveText([/^acme-api/, /^mobile-app/, /^web-dashboard/]);
    await expectSaved(grip);
    await page.keyboard.press("Alt+ArrowDown");
    await expect(favoriteLinks(favorites)).toHaveText(SEEDED_FAVORITE_ORDER);
    await expectSaved(grip);
  });
});

test.describe("Folder cell", () => {
  // Wide enough for the table's `@4xl` Folder column beside the sidebar.
  test.use({ viewport: { width: 1440, height: 900 } });

  test("names each Project relative to the selected Folder", async ({ page }) => {
    await page.goto(`/?${new URLSearchParams({ folder: REPO }).toString()}`);
    const table = page.locator("#conversations");

    await expect(table.getByRole("cell", { name: "this folder", exact: true }).first()).toBeVisible();
    await expect(table.getByRole("cell", { name: /^\.claude\/worktrees\// }).first()).toBeVisible();
  });
});
