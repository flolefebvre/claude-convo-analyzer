// The Recorder popover, driven by the keyboard against a fake Recorder on the
// e2e server's Recorder port. While the fake answers, every open page's
// Recorder item reads "on", so `playwright.config.ts` runs this file in its
// `shared-state` project, after every other spec, never beside an `instant()` scope.

import { expect, test, type Page } from "@playwright/test";

import { startFakeRecorder, type FakeRecorder } from "./fake-recorder";
import { E2E_RECORDER_PORT } from "./ports";

/** Whether focus ever stood on `<body>` while a popover was open, since {@link watchFocus}. */
type FocusWatch = { hasFocusFallenToBody: () => Promise<boolean> };

/** Check on every frame whether the focus fell to `<body>` while a popover is open. */
async function watchFocus(page: Page): Promise<FocusWatch> {
  await page.evaluate(() => {
    const watched = window as Window & { hasFocusFallenToBody?: boolean };
    watched.hasFocusFallenToBody = false;
    const check = () => {
      if (document.activeElement === document.body && document.querySelector('[role="dialog"]') !== null) {
        watched.hasFocusFallenToBody = true;
      }
      requestAnimationFrame(check);
    };
    requestAnimationFrame(check);
  });
  return {
    hasFocusFallenToBody: () =>
      page.evaluate(() => (window as Window & { hasFocusFallenToBody?: boolean }).hasFocusFallenToBody === true),
  };
}

test.describe("Recorder popover", () => {
  // One fake Recorder at a time, on the one port the e2e server reads.
  test.describe.configure({ mode: "serial" });

  let recorder: FakeRecorder;
  test.beforeEach(async () => {
    recorder = await startFakeRecorder({ port: E2E_RECORDER_PORT, sessionIds: ["fake-session"] });
  });
  test.afterEach(async () => {
    await recorder.close();
  });

  const popover = (page: Page) => page.getByRole("dialog");
  const button = (page: Page, name: string) => popover(page).getByRole("button", { name, exact: true });

  /** Open the popover from its trigger, by the keyboard, and watch the focus from then on. */
  async function openPopover(page: Page): Promise<FocusWatch> {
    await page.goto("/");
    await page.getByRole("banner").getByRole("button", { name: "Recorder: on" }).focus();
    await page.keyboard.press("Enter");
    await expect(button(page, "Stop")).toBeFocused();
    return watchFocus(page);
  }

  test("moves the focus to Stop anyway when sessions are active, and back to Stop on Cancel", async ({ page }) => {
    const focus = await openPopover(page);

    await page.keyboard.press("Enter");
    await expect(popover(page).getByRole("alert")).toContainText("1 session sent requests");
    await expect(button(page, "Stop anyway")).toBeFocused();
    expect(await focus.hasFocusFallenToBody()).toBe(false);

    await page.keyboard.press("Shift+Tab");
    await expect(button(page, "Cancel")).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(popover(page).getByRole("alert")).toHaveCount(0);
    await expect(button(page, "Stop")).toBeFocused();
    expect(await focus.hasFocusFallenToBody()).toBe(false);
  });

  test("keeps the focus in the popover through Stop anyway, on Start once the Recorder is off", async ({ page }) => {
    const focus = await openPopover(page);

    await page.keyboard.press("Enter");
    await expect(button(page, "Stop anyway")).toBeFocused();
    await page.keyboard.press("Enter");
    await recorder.stopReceived;

    await expect(popover(page).getByRole("status")).toHaveText("Stopped.");
    await expect(button(page, "Start")).toBeFocused();
    expect(await focus.hasFocusFallenToBody()).toBe(false);
  });
});
