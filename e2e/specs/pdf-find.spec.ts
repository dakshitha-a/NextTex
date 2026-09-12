import { test, expect } from "../fixtures";

/** R-088. Find on the typeset page.
 *
 *  The text layer that makes a page selectable has always carried every
 *  word on it, and there was no way to ask it anything. */

test("Mod-F on the page opens a find bar, and the matches are counted and marked", async ({
  tab,
}) => {
  await expect(tab.locator("canvas").first()).toBeVisible({ timeout: 60_000 });
  // A click on the page gives the preview the keyboard, which is what
  // separates its Mod-F from the editor's own.
  await tab.locator(".nx-page").first().click();
  await tab.keyboard.press("Control+f");
  const box = tab.getByTestId("pdf-find");
  await expect(box).toBeFocused();

  // A word the shipped template has in a heading and in its prose.
  await box.fill("results");
  await expect(tab.getByTestId("pdf-find-count")).toHaveText(/^1 of [1-9]\d*$/, {
    timeout: 20_000,
  });
  await expect(tab.locator(".nx-find-hit")).toHaveCount(1, { timeout: 10_000 });

  // Enter steps, and the count follows.
  await box.press("Enter");
  await expect(tab.getByTestId("pdf-find-count")).toHaveText(/^2 of [2-9]\d*$/);

  // A word the document does not have says so rather than showing 0 of 0.
  await box.fill("xyzzyplugh");
  await expect(tab.getByTestId("pdf-find-count")).toHaveText("Nothing found", {
    timeout: 10_000,
  });

  // Escape closes the bar and hands the keyboard back to the page.
  await box.press("Escape");
  await expect(tab.getByTestId("pdf-find-bar")).toHaveCount(0);
  await expect(tab.locator(".nx-find-hit")).toHaveCount(0);
});

test("Mod-F in the editor is still the editor's own find", async ({ tab }) => {
  await expect(tab.locator(".cm-editor")).toBeVisible({ timeout: 30_000 });
  await tab.locator(".cm-content").click();
  await tab.keyboard.press("Control+f");
  await expect(tab.locator(".cm-panel.cm-search")).toBeVisible();
  await expect(tab.getByTestId("pdf-find-bar")).toHaveCount(0);
});

test("the find box takes the caret once, not on every redraw", async ({ tab }) => {
  // The box was focused from an inline ref callback, which runs on every
  // commit, so a reader who opened find and then clicked the page to
  // select something had the caret pulled back into the input by the
  // next scroll or zoom.
  await expect(tab.locator("canvas").first()).toBeVisible({ timeout: 60_000 });
  await tab.locator(".nx-page").first().click();
  await tab.keyboard.press("Control+f");
  const box = tab.getByTestId("pdf-find");
  await expect(box).toBeFocused();

  await tab.locator(".nx-page").first().click();
  await expect(box).not.toBeFocused();
  // A zoom is a state change that redraws the whole pane.
  await tab.getByRole("button", { name: "Zoom in" }).click();
  await tab.waitForTimeout(300);
  await expect(box).not.toBeFocused();
});
