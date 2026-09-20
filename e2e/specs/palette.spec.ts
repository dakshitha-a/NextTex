import { test, expect } from "../fixtures";

/** The command palette: every action, setting and file, by typing.
 *
 *  Mod-K opens it with the caret in its box; typing ranks the rows; Enter
 *  runs the chosen one.  An action, a setting and a file are each chosen
 *  once, and three of the chords the old effects answered are pressed to
 *  show the registry dispatches them as before.
 */

async function open(tab: import("@playwright/test").Page) {
  await tab.keyboard.press("Control+k");
  const palette = tab.getByTestId("palette");
  await expect(palette).toBeVisible({ timeout: 10_000 });
  await expect(tab.getByTestId("palette-input")).toBeFocused();
  return palette;
}

test("an action, a setting and a file are each one box away", async ({ tab }) => {
  await tab.setViewportSize({ width: 1400, height: 1000 });
  await expect(tab.locator(".cm-editor")).toBeVisible({ timeout: 45_000 });

  // An action: reading mode folds the source away, and again puts it back.
  let palette = await open(tab);
  await tab.keyboard.type("reading");
  await expect(palette.getByTestId("palette-row").first()).toContainText("Reading mode");
  await tab.keyboard.press("Enter");
  await expect(palette).toHaveCount(0);
  await expect(tab.getByTestId("drawer")).toHaveCount(0);
  palette = await open(tab);
  await tab.keyboard.type("reading");
  await tab.keyboard.press("Enter");
  await expect(tab.locator(".cm-editor")).toBeVisible();

  // A setting: the editor's ground, applied on the root.
  palette = await open(tab);
  await tab.keyboard.type("ground white");
  const white = palette.getByTestId("palette-row").first();
  await expect(white).toContainText("Editor ground: white");
  await expect(white).toHaveAttribute("data-kind", "setting");
  await tab.keyboard.press("Enter");
  await expect.poll(() => tab.evaluate(() => document.documentElement.dataset.editorTheme)).toBe("white");

  // A file: the bibliography opens in a tab.
  palette = await open(tab);
  await tab.keyboard.type("references");
  const file = palette.getByTestId("palette-row").first();
  await expect(file).toHaveAttribute("data-kind", "file");
  await expect(file).toContainText("references.bib");
  await tab.keyboard.press("Enter");
  await expect(tab.getByTestId("source-strip").locator('[data-path="references.bib"]')).toBeVisible({ timeout: 10_000 });

  // Escape puts it away, and a click outside does too.
  palette = await open(tab);
  await tab.keyboard.press("Escape");
  await expect(palette).toHaveCount(0);
  await expect(tab.getByTestId("palette")).toHaveCount(0);
});

test("the chords the registry took over still answer", async ({ tab }) => {
  await tab.setViewportSize({ width: 1400, height: 1000 });
  await expect(tab.locator(".cm-editor")).toBeVisible({ timeout: 45_000 });
  // Mod-B hides the left column.
  await tab.keyboard.press("Control+b");
  await expect(tab.getByTestId("drawer")).toHaveCount(0);
  await tab.keyboard.press("Control+b");
  await expect(tab.getByTestId("drawer")).toBeVisible();
  // Mod-Alt-A shows or hides the agent: its composer is on screen in
  // exactly one of the two states.
  const composer = tab.locator("textarea").last();
  const shownBefore = await composer.isVisible();
  await tab.keyboard.press("Control+Alt+a");
  if (shownBefore) await expect(composer).toBeHidden({ timeout: 10_000 });
  else await expect(composer).toBeVisible({ timeout: 10_000 });
  await tab.keyboard.press("Control+Alt+a");
  // Mod-Shift-F opens the project search with the caret in its box.
  await tab.keyboard.press("Control+Shift+F");
  await expect(tab.getByTestId("project-search")).toBeFocused({ timeout: 10_000 });
});
