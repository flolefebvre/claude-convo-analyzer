import os from "node:os";
import path from "node:path";

import { instant } from "@next/playwright";
import { expect, test, type Locator, type Page } from "@playwright/test";

import { type RouteShell, expectData, expectInstantLoad } from "./route-shell";

// A seeded conversation title (`scripts/seed/fake-logs.ts`).
const TITLE = "Split the billing service out of the monolith";

// The seeded `~/dev/acme-api` repo, a Project with worktree Projects below it.
const REPO = path.join(os.homedir(), "dev", "acme-api");

// A seeded worktree Project of {@link REPO}.
const WORKTREE = path.join(REPO, ".claude", "worktrees", "fix-auth-flake");

const header = (page: Page) => page.getByRole("heading", { level: 1, name: "Conversations" });
/** A Folder's chevron, in whichever folder tree (desktop sidebar or phone picker) `scope` holds. */
const chevron = (scope: Page | Locator, label: string) =>
  scope.getByRole("button", { name: `${label} sub-folders`, exact: true });
/** A Folder's name link, whose accessible name starts with its label. */
const folderLink = (scope: Locator, label: string) =>
  scope.getByRole("link", { name: new RegExp(`^${label.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")}\\W`) });

const conversations: RouteShell = {
  shell: (page) => [header(page)],
  fallbacks: (page) => [
    page.getByRole("status", { name: "Loading folders" }),
    page.getByRole("status", { name: "Loading overview" }),
    page.getByRole("status", { name: "Loading conversations" }),
  ],
  data: (page) => [
    page.getByRole("navigation", { name: "Folders" }),
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
