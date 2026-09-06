import { test, expect } from "../fixtures";

/** Theme, interface size and editor text size.
 *
 *  The interface size is a `zoom` on the shell, which leaves the app
 *  straddling two coordinate spaces: reads come back in viewport pixels,
 *  writes are interpreted in zoomed ones.  Everything here that looks like
 *  it is testing arithmetic is testing that boundary.
 */

async function open(page: import("@playwright/test").Page) {
  await page.getByTestId("appearance").first().click();
  await expect(page.getByRole("dialog", { name: "Appearance" })).toBeVisible();
}

test("the editor text can be made bigger and stays that way", async ({ tab }) => {
  const scroller = tab.locator(".cm-scroller");
  const before = await scroller.evaluate((el) => getComputedStyle(el).fontSize);
  expect(before).toBe("13.5px");

  await open(tab);
  await tab.getByRole("button", { name: "Larger editor text" }).click();
  await expect(scroller).toHaveCSS("font-size", "15px");

  // The line height has to follow, or 21px text sits in a 22px line.
  const ratio = await scroller.evaluate((el) => {
    const style = getComputedStyle(el);
    return parseFloat(style.lineHeight) / parseFloat(style.fontSize);
  });
  expect(ratio).toBeGreaterThan(1.5);

  await tab.reload();
  await expect(tab.locator(".cm-scroller")).toHaveCSS("font-size", "15px");
});

test("the interface scales, and the projects screen scales with it", async ({
  tab,
}) => {
  await open(tab);
  await tab.getByRole("button", { name: "Larger interface" }).click();
  await expect(tab.locator("#root")).toHaveCSS("zoom", "1.1");

  // The whole point of putting it on #root: it covers the screens that
  // return before the editor shell is ever built.
  await tab.getByTestId("switch-project").click();
  await expect(tab.getByRole("heading", { name: "NextTex" })).toBeVisible();
  await expect(tab.locator("#root")).toHaveCSS("zoom", "1.1");
  await expect(tab.getByTestId("appearance")).toBeVisible();
});

test("a bigger interface does not soften the page", async ({ tab }) => {
  // `zoom` changes how many device pixels a CSS pixel covers, but not
  // `devicePixelRatio`.  A canvas sized for the old ratio is stretched by
  // the browser, and a blurry preview is the one thing this pane cannot
  // ship.
  const canvas = tab.locator(".pdf-page canvas, canvas").first();
  await canvas.waitFor({ timeout: 30_000 });
  const before = await canvas.evaluate((el) => (el as HTMLCanvasElement).width);

  await open(tab);
  for (const _ of [0, 1, 2]) {
    await tab.getByRole("button", { name: "Larger interface" }).click();
  }
  await tab.keyboard.press("Escape");
  // The redraw is debounced behind the relayout.
  await expect
    .poll(async () => canvas.evaluate((el) => (el as HTMLCanvasElement).width), {
      timeout: 15_000,
    })
    .toBeGreaterThan(before);
});

test("reset puts everything back", async ({ tab }) => {
  await open(tab);
  await tab.getByRole("button", { name: "Larger editor text" }).click();
  await tab.getByRole("button", { name: "Larger interface" }).click();
  await tab.getByRole("button", { name: "Light" }).click();

  await tab.getByRole("button", { name: "Reset to defaults" }).click();
  await expect(tab.locator(".cm-scroller")).toHaveCSS("font-size", "13.5px");
  await expect(tab.locator("#root")).toHaveCSS("zoom", "1");
  await expect(tab.locator("html")).toHaveAttribute("data-theme", "dark");
});

test("a floating card still lands on screen at a larger interface", async ({
  tab,
}) => {
  await open(tab);
  for (const _ of [0, 1, 2]) {
    await tab.getByRole("button", { name: "Larger interface" }).click();
  }
  await tab.keyboard.press("Escape");

  // The file menu clamps itself against the viewport.  Its position is read
  // in viewport pixels and written in zoomed ones, so at 150% an unconverted
  // clamp puts it off the right-hand edge.
  const row = tab.getByRole("treeitem", { name: /main\.tex/ }).first();
  await row.hover();
  await row.getByRole("button", { name: /Actions for/ }).click();
  const menu = tab.getByTestId("file-menu");
  await menu.waitFor({ timeout: 5000 });
  const box = await menu.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(1680 + 1);
});
