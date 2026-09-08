import { test, expect } from "../fixtures";

/** The project bar: sharing, settings, and getting a copy out.
 *
 *  It is a 32px strip that also has to hold the project's name, and "Zip"
 *  and "PDF" spelled out were two words competing with that name for the
 *  room -- two controls that mean the same thing, "give me a copy", sitting
 *  side by side as though they were unrelated.
 */

test("both downloads live behind one button", async ({ tab }) => {
  await expect(tab.locator(".cm-editor")).toBeVisible({ timeout: 45_000 });

  // Nothing is spelled out on the bar itself any more.
  const bar = tab.getByTestId("open-download").locator("xpath=..");
  await expect(bar.getByText("Zip", { exact: true })).toHaveCount(0);

  await expect(tab.getByTestId("download-menu")).toHaveCount(0);
  await tab.getByTestId("open-download").click();

  const menu = tab.getByTestId("download-menu");
  await expect(menu).toBeVisible();
  await expect(menu.getByTestId("download-zip")).toBeVisible();
  await expect(menu.getByTestId("download-pdf")).toBeVisible();

  // The formats are named, because "Whole project" and "Typeset page" say
  // what you get and the extension says what lands in the folder.
  await expect(menu).toContainText(".zip");
  await expect(menu).toContainText(".pdf");
});

test("the menu closes without choosing", async ({ tab }) => {
  await expect(tab.locator(".cm-editor")).toBeVisible({ timeout: 45_000 });
  await tab.getByTestId("open-download").click();
  await expect(tab.getByTestId("download-menu")).toBeVisible();
  await tab.keyboard.press("Escape");
  await expect(tab.getByTestId("download-menu")).toHaveCount(0);
});

test("choosing one puts the menu away", async ({ tab }) => {
  await expect(tab.locator(".cm-editor")).toBeVisible({ timeout: 45_000 });
  await tab.getByTestId("open-download").click();
  await tab.getByTestId("download-zip").click();
  // Left open, the menu would sit over the file list while the download
  // happens somewhere the page cannot see.
  await expect(tab.getByTestId("download-menu")).toHaveCount(0);
});

test("the icon buttons still say what they are", async ({ tab }) => {
  await expect(tab.locator(".cm-editor")).toBeVisible({ timeout: 45_000 });
  // A glyph with no accessible name is a button nobody navigating by name
  // can find, and these lost their text when they became icons.
  await expect(tab.getByRole("button", { name: "Share this project" }))
    .toBeVisible();
  await expect(tab.getByRole("button", { name: "Download a copy" }))
    .toBeVisible();
});
