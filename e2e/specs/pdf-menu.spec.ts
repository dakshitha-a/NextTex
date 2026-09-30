import { test, expect } from "../fixtures";
import type { Page } from "@playwright/test";

/** The typeset page's right-click menu.
 *
 *  The footer's controls at the pointer, grouped as the footer groups
 *  them, with the double-click's jump to the source first.  What each
 *  control does has its own spec (`pdf-view`, `navigation`); this one is
 *  about the gesture reaching them, and about the one right-click it must
 *  leave alone, over a selection, whose Copy is the browser's.
 */

async function firstPage(tab: Page) {
  const canvas = tab.locator(".nx-page canvas:visible").first();
  await expect(canvas).toBeVisible({ timeout: 45_000 });
  await expect.poll(async () => (await canvas.boundingBox())?.width ?? 0, { timeout: 15_000 }).toBeGreaterThan(0);
  return (await canvas.boundingBox())!;
}

async function rightClickPage(tab: Page) {
  const box = await firstPage(tab);
  await tab.mouse.click(box.x + box.width / 2, box.y + box.height * 0.35, { button: "right" });
  const menu = tab.getByTestId("pdf-context-menu");
  await expect(menu).toBeVisible();
  return menu;
}

const caretLine = async (tab: Page) =>
  Number((await tab.getByText(/^Ln \d+, Col \d+$/).innerText()).match(/Ln (\d+)/)?.[1] ?? 0);

test("the page's menu holds the footer's controls, and they work from it", async ({ tab }) => {
  let menu = await rightClickPage(tab);
  await expect(menu.getByRole("menuitem", { name: "Show this in the source" })).toBeVisible();
  await expect(menu.getByRole("menuitemradio", { name: "Fit width" })).toBeVisible();
  // Page steps only where the footer's own arrows are the way to turn.
  await expect(menu.getByRole("menuitem", { name: "Next page" })).toHaveCount(0);

  await menu.getByRole("menuitemradio", { name: "Fit page" }).click();
  await expect(menu).toHaveCount(0);
  menu = await rightClickPage(tab);
  await expect(menu.getByRole("menuitemradio", { name: "Fit page" })).toHaveAttribute("aria-checked", "true");

  await menu.getByRole("menuitemcheckbox", { name: "Dark page" }).click();
  await expect(tab.getByTestId("pdf-sheet")).toHaveAttribute("data-dark-page", "true");
  menu = await rightClickPage(tab);
  await menu.getByRole("menuitemcheckbox", { name: "Dark page" }).click();
  await expect(tab.getByTestId("pdf-sheet")).not.toHaveAttribute("data-dark-page", "true");

  menu = await rightClickPage(tab);
  await menu.getByRole("menuitemradio", { name: "One page at a time" }).click();
  menu = await rightClickPage(tab);
  await expect(menu.getByRole("menuitem", { name: "Previous page" })).toBeDisabled();
  const next = menu.getByRole("menuitem", { name: "Next page" });
  if (await next.isEnabled()) {
    await next.click();
    await expect(tab.getByTestId("page-number")).toHaveValue("2");
  } else {
    await tab.keyboard.press("Escape");
  }
  // Back to scrolling, as the next spec to share this browser expects.
  menu = await rightClickPage(tab);
  await menu.getByRole("menuitemradio", { name: "Scroll" }).click();
  menu = await rightClickPage(tab);
  await menu.getByRole("menuitemradio", { name: "Fit width" }).click();
});

test("Show this in the source jumps as a double-click on the same spot does", async ({ tab }) => {
  const menu = await rightClickPage(tab);
  await menu.getByRole("menuitem", { name: "Show this in the source" }).click();
  await expect.poll(() => caretLine(tab), { timeout: 20_000 }).toBeGreaterThan(1);
});

test("Find in the preview opens the page's find", async ({ tab }) => {
  const menu = await rightClickPage(tab);
  await menu.getByRole("menuitem", { name: "Find in the preview" }).click();
  await expect(tab.getByTestId("pdf-find")).toBeFocused();
  await tab.keyboard.press("Escape");
});

test("a right-click over selected text keeps the browser's menu, for Copy", async ({ tab }) => {
  await firstPage(tab);
  // Select a word of the page's text layer, as a reader does before Copy.
  const at = await tab.evaluate(() => {
    const span = Array.from(document.querySelectorAll<HTMLElement>(".nx-page .nx-text-layer span"))
      .find((node) => (node.textContent ?? "").trim().length > 3);
    if (!span) return null;
    const range = document.createRange();
    range.selectNodeContents(span);
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
    const box = span.getBoundingClientRect();
    return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  });
  expect(at).not.toBeNull();
  await tab.mouse.click(at!.x, at!.y, { button: "right" });
  await expect(tab.getByTestId("pdf-context-menu")).toHaveCount(0);

  // With the selection gone the same spot opens the menu, which proves the
  // count of nothing above had time to be wrong.
  await tab.evaluate(() => window.getSelection()?.removeAllRanges());
  await tab.mouse.click(at!.x, at!.y, { button: "right" });
  await expect(tab.getByTestId("pdf-context-menu")).toBeVisible();
  await tab.keyboard.press("Escape");
});
