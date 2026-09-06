import { test, expect } from "../fixtures";
import type { Page } from "@playwright/test";

/** Zooming the preview the way everything else zooms.
 *
 *  A browser delivers a trackpad pinch as a wheel event with `ctrlKey`
 *  set, so one handler covers both that and ctrl with a mouse wheel.  What
 *  makes it worth a spec is the half that is easy to get wrong: the
 *  listener must be a native, non-passive one, because React registers
 *  `wheel` passively and silently ignores `preventDefault` -- and the
 *  visible symptom of getting that wrong is the whole application zooming
 *  instead of the document.
 */

/** A pinch, as the browser reports one. */
async function pinch(page: Page, deltaY: number, at: { x: number; y: number }) {
  await page.evaluate(
    ({ deltaY, at }) => {
      // Dispatched at a point rather than on a selector, because what is
      // under the pointer is exactly what the handler anchors the zoom to.
      const target = document.elementFromPoint(at.x, at.y) ?? document.body;
      target.dispatchEvent(
        new WheelEvent("wheel", {
          deltaY,
          ctrlKey: true,
          clientX: at.x,
          clientY: at.y,
          bubbles: true,
          cancelable: true,
        }),
      );
    },
    { deltaY, at },
  );
}

async function ready(page: Page) {
  await expect(page.locator("canvas").first()).toBeVisible({ timeout: 45_000 });
  await expect(page.getByTestId("zoom")).toBeVisible();
}

function percent(page: Page) {
  return page
    .getByTestId("zoom")
    .innerText()
    .then((text) => Number(text.replace("%", "")));
}

test("ctrl and the wheel zooms the preview in and out", async ({ tab }) => {
  await ready(tab);
  const box = (await tab.locator("canvas").first().boundingBox())!;
  const at = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  const before = await percent(tab);

  await pinch(tab, -120, at);
  await expect.poll(() => percent(tab)).toBeGreaterThan(before);

  const zoomedIn = await percent(tab);
  await pinch(tab, 240, at);
  await expect.poll(() => percent(tab)).toBeLessThan(zoomedIn);
});

test("the page really changes size, not just the number", async ({ tab }) => {
  await ready(tab);
  const page = tab.locator(".nx-page").first();
  const before = (await page.boundingBox())!.width;
  const box = (await page.boundingBox())!;

  await pinch(tab, -300, { x: box.x + box.width / 2, y: box.y + 40 });
  await expect
    .poll(async () => (await page.boundingBox())!.width, { timeout: 10_000 })
    .toBeGreaterThan(before);
});

test("the zoom stays inside the range the buttons offer", async ({ tab }) => {
  await ready(tab);
  const box = (await tab.locator("canvas").first().boundingBox())!;
  const at = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  for (let i = 0; i < 25; i += 1) await pinch(tab, -400, at);
  await expect.poll(() => percent(tab), { timeout: 10_000 }).toBe(300);
  for (let i = 0; i < 40; i += 1) await pinch(tab, 400, at);
  await expect.poll(() => percent(tab), { timeout: 10_000 }).toBe(25);
});

test("an ordinary scroll still scrolls rather than zooming", async ({ tab }) => {
  await ready(tab);
  const before = await percent(tab);
  const box = (await tab.locator("canvas").first().boundingBox())!;
  await tab.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await tab.mouse.wheel(0, 300);
  await tab.waitForTimeout(400);
  expect(await percent(tab)).toBe(before);
});
