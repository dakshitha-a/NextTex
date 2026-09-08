import { test, expect } from "../fixtures";
import type { Page } from "@playwright/test";

/** Selecting text on the typeset page.
 *
 *  The selectable text is a layer of transparent spans sitting exactly over
 *  the drawn glyphs, which is how every PDF viewer in a browser does it. The
 *  part that is easy to get wrong is what `::selection` does to them: giving
 *  it a background but not a colour lets the browser paint its own selection
 *  foreground, which makes the *invisible* layer visible on top of the
 *  canvas. The reader then sees every selected word twice, a pixel or two
 *  apart, in two slightly different shapes -- which reads as a rendering
 *  fault rather than as a selection.
 */

async function ready(page: Page) {
  await expect(page.locator("canvas").first()).toBeVisible({ timeout: 45_000 });
  await expect(page.locator(".nx-text-layer span").first()).toBeAttached({
    timeout: 45_000,
  });
}

/** Drag from the start of one span to the end of a later one. */
async function selectAcross(page: Page) {
  const spans = page.locator(".nx-text-layer span");
  const first = (await spans.nth(0).boundingBox())!;
  const count = await spans.count();
  const last = (await spans.nth(Math.min(count - 1, 12)).boundingBox())!;
  await page.mouse.move(first.x + 1, first.y + first.height / 2);
  await page.mouse.down();
  await page.mouse.move(last.x + last.width - 1, last.y + last.height / 2, {
    steps: 12,
  });
  await page.mouse.up();
}

test("selected text is not painted on top of the page", async ({ tab }) => {
  await ready(tab);
  await selectAcross(tab);

  const selected = await tab.evaluate(() => String(window.getSelection() ?? ""));
  expect(selected.trim().length).toBeGreaterThan(0);

  // The layer must stay invisible *while it is selected*, which is a
  // different declaration from the one that makes it invisible at rest --
  // and the one that was missing. Asking for the span's own colour is not
  // enough: that was already transparent while every selected word was
  // being drawn twice.
  const selection = await tab.evaluate(() => {
    const span = document.querySelector(".nx-text-layer span");
    if (!span) return { color: "no span", background: "" };
    const style = getComputedStyle(span, "::selection");
    return { color: style.color, background: style.backgroundColor };
  });
  expect(selection.color).toMatch(/rgba\(0, 0, 0, 0\)|transparent/);
  // ...and there is still a highlight, or nothing would look selected.
  expect(selection.background).not.toMatch(/rgba\(0, 0, 0, 0\)|^$/);

  await tab.locator(".nx-page").first().screenshot({
    path: "shots/out-pdf-selection.png",
  });
});
