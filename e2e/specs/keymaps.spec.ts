import { test, expect } from "../fixtures";

/** Vim and Emacs, chosen on the settings sheet and loaded only then.
 *
 *  With Vim chosen, `dd` in normal mode removes a line and `u` puts it
 *  back through the document's own undo; the choice survives a reload.
 *  With Emacs, `C-k` kills to the end of the line and `C-/` restores it.
 *  Back on the default, `dd` is two letters typed.
 */

async function choose(tab: import("@playwright/test").Page, id: string) {
  await tab.getByTestId("appearance").first().click();
  const sheet = tab.getByRole("dialog", { name: "Settings" });
  await expect(sheet).toBeVisible();
  await sheet.getByTestId(id).click();
  await expect(sheet.getByTestId(id)).toHaveAttribute("aria-pressed", "true");
  await tab.getByTestId("settings-close").click();
}

test("Vim removes a line with dd and puts it back with u, and the choice is kept", async ({ tab }) => {
  await expect(tab.locator(".cm-editor")).toBeVisible({ timeout: 45_000 });
  const editor = tab.locator(".cm-content");
  await editor.click();
  await tab.keyboard.press("Control+End");
  await tab.keyboard.type("\nA line Vim will remove.");
  await expect(editor).toContainText("A line Vim will remove.");

  await choose(tab, "keymap-vim");
  await editor.click();
  await tab.keyboard.press("Control+End");
  // The Vim status line is the sign the keymap has arrived.
  await expect(tab.locator(".cm-vim-panel")).toBeVisible({ timeout: 15_000 });
  await tab.keyboard.press("Escape");
  await tab.keyboard.type("dd");
  await expect(editor).not.toContainText("A line Vim will remove.");
  await tab.keyboard.type("u");
  await expect(editor).toContainText("A line Vim will remove.");

  await tab.reload();
  await expect(tab.locator(".cm-editor")).toBeVisible({ timeout: 45_000 });
  await expect(tab.locator(".cm-vim-panel")).toBeVisible({ timeout: 15_000 });
});

test("Emacs kills to the end of the line with C-k and C-/ restores it", async ({ tab }) => {
  await expect(tab.locator(".cm-editor")).toBeVisible({ timeout: 45_000 });
  await choose(tab, "keymap-emacs");
  const editor = tab.locator(".cm-content");
  await editor.click();
  await tab.keyboard.press("Control+End");
  // The mode's class on the scroller is the sign the keymap has arrived.
  await expect(tab.locator(".cm-emacsMode")).toHaveCount(1, { timeout: 15_000 });
  await tab.keyboard.type("\nkeep this, kill that");
  await expect(editor).toContainText("keep this, kill that");
  // The document's undo manager folds edits made within half a second
  // into one step, so a kill typed straight after the line would be
  // undone together with the line; a writer pauses, and so does this.
  await tab.waitForTimeout(700);
  await tab.keyboard.press("Home");
  // C-k, which is also the palette's chord: the editor answers first and
  // the palette must stay shut.
  await tab.keyboard.press("Control+k");
  await expect(editor).not.toContainText("keep this, kill that");
  await expect(tab.getByTestId("palette")).toHaveCount(0);
  await tab.keyboard.press("Control+/");
  await expect(editor).toContainText("keep this, kill that");
});

test("back on the default keymap, dd is two letters", async ({ tab }) => {
  await expect(tab.locator(".cm-editor")).toBeVisible({ timeout: 45_000 });
  await choose(tab, "keymap-vim");
  await expect(tab.locator(".cm-vim-panel")).toBeVisible({ timeout: 15_000 });
  await choose(tab, "keymap-default");
  await expect(tab.locator(".cm-vim-panel")).toHaveCount(0, { timeout: 15_000 });
  const editor = tab.locator(".cm-content");
  await editor.click();
  await tab.keyboard.press("Control+End");
  await tab.keyboard.type("\ndd");
  await expect(editor).toContainText("dd");
});
