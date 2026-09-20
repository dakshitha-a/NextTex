import { test, expect } from "../fixtures";

/** The settings sheet, master-detail.
 *
 *  Four groups down the left, one group's rows at the right, so the writer
 *  reads four things and then seven rather than twenty. The list is a
 *  tablist the arrows walk; the group is remembered per browser; below
 *  720 px the list is a row of segments above the rows; and Done, the
 *  close, Escape and the scrim all leave.
 */

async function open(tab: import("@playwright/test").Page) {
  await tab.getByTestId("appearance").first().click();
  const sheet = tab.getByRole("dialog", { name: "Settings" });
  await expect(sheet).toBeVisible();
  return sheet;
}

test("one group's rows at a time, walked with the arrows", async ({ tab }) => {
  const sheet = await open(tab);
  // Lands on How it looks, and the rows are that group's alone.
  await expect(sheet.getByRole("tab", { name: /How it looks/ })).toHaveAttribute("aria-selected", "true");
  await expect(sheet.getByTestId("theme-dark")).toBeVisible();
  await expect(sheet.getByTestId("keymap-vim")).toHaveCount(0);

  // The arrows move between the groups, and the pane follows.
  await sheet.getByRole("tab", { name: /How it looks/ }).focus();
  await tab.keyboard.press("ArrowDown");
  await expect(sheet.getByRole("tab", { name: /While you write/ })).toBeFocused();
  await expect(sheet.getByTestId("keymap-vim")).toBeVisible();
  await expect(sheet.getByTestId("theme-dark")).toHaveCount(0);
  await tab.keyboard.press("End");
  await expect(sheet.getByRole("tab", { name: /This install/ })).toBeFocused();
  await expect(sheet.getByTestId("open-access")).toBeVisible();
  // Tab leaves the list for the rows.
  await tab.keyboard.press("Tab");
  await expect(sheet.getByRole("tab", { name: /This install/ })).not.toBeFocused();

  // Every group says where its choices live.
  await expect(sheet.getByRole("tab", { name: /This project/ })).toContainText("kept with the project");
  await sheet.getByRole("tab", { name: /This project/ }).click();
  await expect(sheet.getByRole("switch", { name: "Compile as you type" })).toBeVisible();
  await expect(sheet.getByTestId("engine-pdflatex")).toBeVisible();

  // Done leaves.
  await sheet.getByRole("button", { name: "Done" }).click();
  await expect(sheet).toHaveCount(0);
});

test("the group is remembered, and This project is absent on the projects screen", async ({ tab }) => {
  let sheet = await open(tab);
  await sheet.getByTestId("settings-group-project").click();
  await tab.keyboard.press("Escape");
  await expect(sheet).toHaveCount(0);

  sheet = await open(tab);
  await expect(sheet.getByRole("tab", { name: /This project/ })).toHaveAttribute("aria-selected", "true");
  await tab.getByTestId("settings-close").click();
  await expect(sheet).toHaveCount(0);

  // On the projects screen there is no project to keep anything with, so
  // the group is not offered and the sheet lands on How it looks.
  await tab.getByTestId("switch-project").click();
  await expect(tab.getByRole("heading", { name: "NextTex" })).toBeVisible();
  sheet = await open(tab);
  await expect(sheet.getByRole("tab", { name: /This project/ })).toHaveCount(0);
  await expect(sheet.getByRole("tab", { name: /How it looks/ })).toHaveAttribute("aria-selected", "true");
  await expect(sheet.getByRole("tab")).toHaveCount(3);
});

test("below 720 px the groups are a row of segments above the rows", async ({ tab }) => {
  await tab.setViewportSize({ width: 600, height: 800 });
  const sheet = await open(tab);
  const list = sheet.getByRole("tablist");
  await expect(list).toHaveAttribute("aria-orientation", "horizontal");
  const look = await sheet.getByRole("tab", { name: /How it looks/ }).boundingBox();
  const write = await sheet.getByRole("tab", { name: /While you write/ }).boundingBox();
  // Side by side rather than one under the other.
  expect(Math.abs(look!.y - write!.y)).toBeLessThan(4);
  expect(write!.x).toBeGreaterThan(look!.x);
  // And the rows under them, inside the window.
  const row = await sheet.getByTestId("theme-dark").boundingBox();
  expect(row!.y).toBeGreaterThan(look!.y + look!.height);
  expect(row!.x + row!.width).toBeLessThanOrEqual(600);
  // The arrows walk sideways here.
  await sheet.getByRole("tab", { name: /How it looks/ }).focus();
  await tab.keyboard.press("ArrowRight");
  await expect(sheet.getByRole("tab", { name: /While you write/ })).toBeFocused();
});

test("the rows say what they hold: a title, a subtitle where it earns its place, the control at the right", async ({ tab }) => {
  const sheet = await open(tab);
  await expect(sheet.getByText("Everything but the typeset page.")).toBeVisible();
  // A row without a subtitle has none: the pane is not padded with them.
  const theme = sheet.locator(".nx-settings-row", { hasText: "Theme" }).first();
  await expect(theme.locator("small")).toHaveCount(0);
  // The control sits at the row's right edge.
  const rowBox = (await theme.boundingBox())!;
  const control = (await sheet.getByRole("group", { name: "Theme" }).boundingBox())!;
  expect(control.x + control.width).toBeGreaterThan(rowBox.x + rowBox.width - 4);
  // Rows are 46 px or taller, as the page draws them.
  expect(rowBox.height).toBeGreaterThanOrEqual(46);
});
