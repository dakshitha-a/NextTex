import { test, expect, openProject } from "../fixtures";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { watchEvents } from "../events";
import type { Download, Page } from "@playwright/test";

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
  // A page's picture arrives in a layer faded in over the one before, and
  // the one before is then taken away, so the first canvas can be gone
  // between being seen and being measured; this waits for one that has a
  // box to measure.
  await expect
    .poll(async () => (await page.locator("canvas").first().boundingBox())?.width ?? 0, { timeout: 15_000 })
    .toBeGreaterThan(0);
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

test("the text on the page can be selected", async ({ tab }) => {
  // A canvas is a picture: it cannot be selected, searched or copied out
  // of, which for a document somebody is quoting from is most of what a
  // PDF is for.
  await ready(tab);
  const layer = tab.locator(".nx-text-layer span").first();
  await expect(layer).toBeAttached({ timeout: 45_000 });

  const selected = await tab.evaluate(() => {
    const span = document.querySelector(".nx-text-layer span");
    if (!span) return "";
    const range = document.createRange();
    range.selectNodeContents(span);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    return selection?.toString() ?? "";
  });
  expect(selected.trim().length).toBeGreaterThan(0);
});

test("the text layer does not swallow the jump to source", async ({ tab }) => {
  // The double-click that opens the source line is bound on .nx-page,
  // beneath the layer.  Spans take pointer events so a drag selects; the
  // layer itself must not, or the gesture would land on nothing.
  await ready(tab);
  await expect(tab.locator(".nx-text-layer span").first()).toBeAttached({
    timeout: 45_000,
  });
  const through = await tab.evaluate(() => {
    const layer = document.querySelector(".nx-text-layer") as HTMLElement | null;
    return layer ? getComputedStyle(layer).pointerEvents : "";
  });
  expect(through).toBe("none");
});

test("a page can be named in either mode, and the zoom is where it was left", async ({
  tab,
}) => {
  // R-099. Next page, previous page and the arrow keys were all gated on
  // page mode, so a reader in the scrolling one had no way to reach page
  // 74 of a thesis except by dragging, and the readout was never an input
  // in either. The view mode was remembered between sessions and the zoom
  // was not, though the zoom is the one a reader sets for their eyes.
  await expect(tab.locator(".cm-editor")).toBeVisible({ timeout: 45_000 });
  const box = tab.getByTestId("page-number");
  await expect(box).toBeVisible({ timeout: 60_000 });
  // The scrolling mode is the default, and this is the control that was
  // absent from it entirely.
  await expect(tab.getByRole("button", { name: "Next page" })).toBeVisible();

  await tab.getByRole("button", { name: "Zoom in" }).click();
  const zoomed = await tab.getByTestId("zoom").innerText();

  await tab.reload();
  await expect(tab.getByTestId("zoom")).toHaveText(zoomed, { timeout: 60_000 });
});

/** The bytes a download delivered, read back from where the browser put
 *  them. */
async function bytesOf(download: Download): Promise<Buffer> {
  const path = await download.path();
  const { readFileSync } = await import("node:fs");
  return readFileSync(path!);
}

test("the rendered page can be saved without rebuilding it", async ({
  tab, app, project,
}) => {
  // R-098. The only way to save the page was the Download drawer, whose
  // PDF chip forces a full server rebuild first: a wait for a file the
  // reader is already looking at.
  //
  // This asserted the control's href and its download attribute, which is
  // what a link has and says nothing about what a press delivers.  Both
  // held while the file landed as `pdf.pdf`: the route this points at
  // sends no Content-Disposition, a bare `download` attribute falls back
  // to the URL's last segment, and Chromium added the extension.  So
  // the press is what is asserted now: the file, its name, its bytes, and
  // that nothing was rebuilt to produce it.
  await expect(tab.locator(".cm-editor")).toBeVisible({ timeout: 45_000 });
  // A rendered page first: the control is offered only once there is one,
  // because a Save that fetches nothing is worse than no Save.
  await expect(tab.getByTestId("page-number")).toBeVisible({ timeout: 60_000 });
  const save = tab.getByTestId("save-pdf");
  await expect(save).toBeVisible({ timeout: 20_000 });

  const watch = await watchEvents(app, project.id);
  const [saved] = await Promise.all([
    tab.waitForEvent("download", { timeout: 20_000 }),
    save.click(),
  ]);
  expect(saved.suggestedFilename()).toBe("main.pdf");
  const bytes = await bytesOf(saved);
  expect(bytes.subarray(0, 4).toString("latin1")).toBe("%PDF");
  // The promise the control makes: the page as it stands, not a new one.
  await tab.waitForTimeout(500);
  expect(watch.count("compile_start")).toBe(0);
  watch.stop();
});

test("the preview strip drops its last controls before it clips them, at every pane width", async ({
  tab,
}) => {
  // The README's screenshot at 1680 showed "Dow" at the strip's edge: the
  // fit control and Download were kept at widths the row could not hold,
  // because their drop thresholds were guessed below what the controls
  // measure.  Whatever the pane's width, the strip holds what it shows.
  await ready(tab);
  const strip = tab.getByTestId("preview-footer");
  for (const width of [1680, 1400, 1100, 900]) {
    await tab.setViewportSize({ width, height: 900 });
    await tab.waitForTimeout(300);
    const box = await strip.evaluate((el) => {
      const link = el.querySelector('[data-testid="save-pdf"]');
      return {
        scroll: el.scrollWidth, client: el.clientWidth,
        download: !!link && getComputedStyle(link).display !== "none",
      };
    });
    expect(box.scroll, `the strip overflows at ${width}px`).toBeLessThanOrEqual(box.client);
    // And the last control is either shown whole or not at all.
    if (box.download) {
      const link = await tab.getByTestId("save-pdf").boundingBox();
      const edge = await strip.boundingBox();
      expect(link!.x + link!.width).toBeLessThanOrEqual(edge!.x + edge!.width);
    }
  }
});

/** A pinch that holds still: the point under the fingers stays under them.
 *
 *  A pinch on a page past the first slid the page under the pointer, a
 *  few pixels a frame, because the gesture scaled the whole scroll offset
 *  as though the padding and the gaps between pages grew with the pages;
 *  and every frame resized every page to whole pixels and then scrolled by
 *  a fraction, so the page shimmered by a pixel either way. Zooming out
 *  from the fitted width drew the page shrinking towards the pointer, and
 *  then it jumped to the middle of the pane when the gesture ended. These
 *  read a page's place on every frame of a slow gesture, as a trackpad
 *  delivers one, and through the moment it is committed. */
async function longDocument(
  app: { base: string; token: string }, project: { root: string }, page: Page, interfaceSize = 100,
) {
  if (interfaceSize !== 100) {
    await page.addInitScript((size) => localStorage.setItem("nexttex.ui.scale", String(size)), interfaceSize);
  }
  const pages = Array.from({ length: 12 }, (_, i) => `Page ${i + 1} of the document.\n\\newpage`).join("\n");
  writeFileSync(join(project.root, "main.tex"),
    `\\documentclass{article}\n\\begin{document}\n${pages}\n\\end{document}\n`);
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.goto(`${app.base}/?token=${app.token}`);
  await page.getByText("Projects", { exact: false }).first().waitFor();
  await openProject(page, project.root);
  await expect(page.locator(".nx-page")).toHaveCount(12, { timeout: 60_000 });
  await expect(page.locator(".nx-page canvas").first()).toBeVisible({ timeout: 45_000 });
}

type Glide = {
  /** The farthest the point first under the pointer strayed from it, in
   *  screen pixels, over every frame of the gesture. */
  worst: number;
  /** The page's box on the gesture's last frame. */
  last: { left: number; top: number; width: number; height: number };
};

/** A gesture of many small steps, one a frame, read after each. */
async function glide(
  page: Page,
  options: { index: number; at: { x: number; y: number }; deltaY: number; steps: number },
): Promise<Glide> {
  return page.evaluate(async ({ index, at, deltaY, steps }) => {
    const frame = () => new Promise((done) => requestAnimationFrame(() => done(null)));
    const sheet = document.querySelectorAll(".nx-page")[index] as HTMLElement;
    const read = () => {
      const box = sheet.getBoundingClientRect();
      return { left: box.left, top: box.top, width: box.width, height: box.height };
    };
    const start = read();
    const fx = (at.x - start.left) / start.width;
    const fy = (at.y - start.top) / start.height;
    let worst = 0;
    for (let step = 0; step < steps; step += 1) {
      const target = document.elementFromPoint(at.x, at.y) ?? document.body;
      target.dispatchEvent(new WheelEvent("wheel", {
        deltaY, ctrlKey: true, clientX: at.x, clientY: at.y, bubbles: true, cancelable: true,
      }));
      await frame();
      await frame();
      const now = read();
      worst = Math.max(
        worst,
        Math.abs(now.left + fx * now.width - at.x),
        Math.abs(now.top + fy * now.height - at.y),
      );
    }
    return { worst, last: read() };
  }, options);
}

async function boxOf(page: Page, index: number) {
  return page.evaluate((index) => {
    const box = (document.querySelectorAll(".nx-page")[index] as HTMLElement).getBoundingClientRect();
    return { left: box.left, top: box.top, width: box.width, height: box.height };
  }, index);
}

for (const size of [100, 150]) {
test(`a pinch on a page past the first keeps the pointer's point still, and the end does not move it, at ${size}%`, async ({
  app, project, page,
}) => {
  // At 150% the pointer is in screen pixels and the scroll in the shell's,
  // which the gesture had taken for the same thing.
  test.setTimeout(120_000);
  await longDocument(app, project, page, size);
  // Page six, a third of the way into the view, off its centre.
  await page.evaluate(() => {
    const sixth = document.querySelectorAll(".nx-page")[5] as HTMLElement;
    const scroller = document.querySelector('[data-testid="pdf-sheet"]')!.parentElement!;
    scroller.scrollTop = sixth.offsetTop - 80;
  });
  await page.waitForTimeout(400);
  const page6 = await boxOf(page, 5);
  const at = { x: page6.left + page6.width * 0.3, y: page6.top + 200 };
  const fx = (at.x - page6.left) / page6.width;
  const fy = (at.y - page6.top) / page6.height;

  const zoomIn = await glide(page, { index: 5, at, deltaY: -4, steps: 40 });
  expect(zoomIn.worst, "the page slid under the pointer while zooming in").toBeLessThanOrEqual(2);
  // Committed, laid out and redrawn: the point is where the gesture left it.
  await page.waitForTimeout(900);
  const rest = await boxOf(page, 5);
  expect(Math.abs(rest.left + fx * rest.width - at.x)).toBeLessThanOrEqual(2);
  expect(Math.abs(rest.top + fy * rest.height - at.y)).toBeLessThanOrEqual(2);

  const zoomOut = await glide(page, { index: 5, at, deltaY: 3, steps: 30 });
  expect(zoomOut.worst, "the page slid under the pointer while zooming out").toBeLessThanOrEqual(2);
  await page.waitForTimeout(900);
  const after = await boxOf(page, 5);
  expect(Math.abs(after.left + fx * after.width - at.x)).toBeLessThanOrEqual(2);
  expect(Math.abs(after.top + fy * after.height - at.y)).toBeLessThanOrEqual(2);
});
}

test("zooming out from the fitted width keeps the page in the middle, and it does not jump at the end", async ({
  app, project, page,
}) => {
  test.setTimeout(120_000);
  await longDocument(app, project, page);
  const first = await boxOf(page, 0);
  // Near the page's left edge, where a pointer-anchored shrink would pull
  // the page away from the middle of the pane.
  const at = { x: first.left + 40, y: first.top + 150 };
  const out = await glide(page, { index: 0, at, deltaY: 4, steps: 30 });
  await page.waitForTimeout(900);
  const rest = await boxOf(page, 0);
  expect(Math.abs(rest.left - out.last.left), "the page jumped sideways when the gesture ended").toBeLessThanOrEqual(2);
  expect(Math.abs(rest.top - out.last.top), "the page jumped when the gesture ended").toBeLessThanOrEqual(2);
  expect(Math.abs(rest.width - out.last.width)).toBeLessThanOrEqual(2);
  const pane = await page.evaluate(() => {
    const box = document.querySelector('[data-testid="pdf-sheet"]')!.parentElement!.getBoundingClientRect();
    return { left: box.left, width: box.width };
  });
  // In the middle of the pane, give or take the scrollbar.
  const middle = rest.left + rest.width / 2 - (pane.left + pane.width / 2);
  expect(Math.abs(middle)).toBeLessThanOrEqual(10);
});

test("a pinch that pauses past the commit and goes on does not jump back", async ({
  app, project, page,
}) => {
  test.setTimeout(120_000);
  await longDocument(app, project, page);
  await page.evaluate(() => {
    const third = document.querySelectorAll(".nx-page")[2] as HTMLElement;
    const scroller = document.querySelector('[data-testid="pdf-sheet"]')!.parentElement!;
    scroller.scrollTop = third.offsetTop - 60;
  });
  await page.waitForTimeout(400);
  const third = await boxOf(page, 2);
  const at = { x: third.left + third.width * 0.6, y: third.top + 260 };
  const fx = (at.x - third.left) / third.width;
  const fy = (at.y - third.top) / third.height;
  await glide(page, { index: 2, at, deltaY: -4, steps: 20 });
  // Long enough for the commit to fire and its layout to begin.
  await page.waitForTimeout(300);
  const again = await glide(page, { index: 2, at, deltaY: -4, steps: 20 });
  expect(again.worst).toBeLessThanOrEqual(2);
  await page.waitForTimeout(900);
  const rest = await boxOf(page, 2);
  expect(Math.abs(rest.left + fx * rest.width - at.x)).toBeLessThanOrEqual(2);
  expect(Math.abs(rest.top + fy * rest.height - at.y)).toBeLessThanOrEqual(2);
});
