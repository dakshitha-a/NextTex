import type { Page } from "@playwright/test";
import { test, expect } from "../fixtures";

/** Panes slide rather than snap.
 *
 *  The writer found panes opening and closing "a bit aggressive", reading
 *  and writing modes most of all, and asked for a slide that still feels
 *  fast, like the Claude column's when it lies over the panes. A pane
 *  that folds now keeps its width and slides off its outer edge in the
 *  leave's 140 ms, its neighbour taking up the space, and comes back in
 *  the move's 180 ms. Reading and writing modes fold several panes in one
 *  render, so they move as one. Under reduced motion nothing slides.
 *
 *  Each test records, on every animation frame, the margin a pane is
 *  pushed off its edge by, and reads the frames back.
 */

type Frames = Record<string, number[]>;

/** Records each named element's margin on its outer side, every frame,
 *  until the returned function is called. */
async function record(tab: Page, watch: Record<string, { testid: string; side: "left" | "right" }>) {
  await tab.evaluate((watch) => {
    const frames: Record<string, number[]> = {};
    for (const name of Object.keys(watch)) frames[name] = [];
    let running = true;
    const tick = () => {
      if (!running) return;
      for (const [name, { testid, side }] of Object.entries(watch)) {
        const element = document.querySelector(`[data-testid="${testid}"]`) as HTMLElement | null;
        const style = element ? getComputedStyle(element) : null;
        frames[name].push(
          style && style.display !== "none"
            ? parseFloat(side === "left" ? style.marginLeft : style.marginRight)
            : NaN,
        );
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    (window as unknown as { __motion: () => Record<string, number[]> }).__motion = () => {
      running = false;
      return frames;
    };
  }, watch);
  return async (): Promise<Frames> => {
    await tab.waitForTimeout(700);
    return tab.evaluate(() => (window as unknown as { __motion: () => Record<string, number[]> }).__motion());
  };
}

/** Frames in which the pane was part of the way off its edge. */
const between = (frames: number[]) => frames.filter((m) => Number.isFinite(m) && m < -4);

test.beforeEach(async ({ tab }) => {
  await tab.setViewportSize({ width: 1600, height: 1000 });
  await expect(tab.locator(".cm-editor")).toBeVisible({ timeout: 30_000 });
});

test("folding the source slides it off, and unfolding slides it back", async ({ tab }) => {
  const width = await tab.getByTestId("editor-pane").evaluate((e) => (e as HTMLElement).offsetWidth);
  let stop = await record(tab, { source: { testid: "editor-pane", side: "left" } });
  await tab.getByTestId("tabs-blank").click();
  let frames = (await stop()).source;
  const partWay = frames.filter((m) => Number.isFinite(m) && m < -4 && m > -width + 4);
  expect(partWay.length, `margins ${frames.join(",")}`).toBeGreaterThan(1);
  await expect(tab.getByTestId("editor-pane")).toBeHidden();
  await expect(tab.getByTestId("collapsed-source")).toBeVisible();

  stop = await record(tab, { source: { testid: "editor-pane", side: "left" } });
  await tab.getByTestId("collapsed-source").click();
  frames = (await stop()).source;
  expect(frames.filter((m) => Number.isFinite(m) && m < -4 && m > -width + 4).length, `margins ${frames.join(",")}`)
    .toBeGreaterThan(1);
  await expect(tab.getByTestId("editor-pane")).toBeVisible();
  await expect(tab.getByTestId("collapsed-source")).toHaveCount(0);
  // At rest it is back to its share of the row, not a fixed width.
  await expect.poll(() => tab.getByTestId("editor-pane").evaluate((e) => (e as HTMLElement).style.flexGrow))
    .not.toBe("0");
});

test("reading mode moves the source and the Claude column in the same frames", async ({ tab }) => {
  const stop = await record(tab, {
    source: { testid: "editor-pane", side: "left" },
    claude: { testid: "chat-panel", side: "right" },
  });
  await tab.getByTestId("preview-header").dblclick();
  const frames = await stop();
  const together = frames.source
    .map((m, i) => [m, frames.claude[i]])
    .filter(([a, b]) => Number.isFinite(a) && Number.isFinite(b) && a < -4 && b < -4);
  expect(together.length, `source ${frames.source.join(",")} claude ${frames.claude.join(",")}`).toBeGreaterThan(1);
  await expect(tab.locator(".cm-editor")).toBeHidden();
  await expect(tab.getByTestId("chat-panel")).toBeHidden();

  await tab.getByTestId("preview-header").dblclick();
  await expect(tab.locator(".cm-editor")).toBeVisible();
  await expect(tab.getByTestId("chat-panel")).toBeVisible();
});

test("under reduced motion a pane folds at once", async ({ tab }) => {
  await tab.emulateMedia({ reducedMotion: "reduce" });
  const stop = await record(tab, { source: { testid: "editor-pane", side: "left" } });
  await tab.getByTestId("tabs-blank").click();
  const frames = (await stop()).source;
  expect(between(frames), `margins ${frames.join(",")}`).toHaveLength(0);
  await expect(tab.getByTestId("editor-pane")).toBeHidden();
});

/** A frame of a fold: the pane's width and how far it is off its edge
 *  while it is drawn, its neighbour's width, the width of the place its
 *  strip takes, and the width of the preview's first page bitmap. */
type Box = { width: number; margin: number; other: number; strip: number; shown: boolean; canvas: number };

/** Records, every frame, a pane's width, how far it is off its edge, the
 *  width of its neighbour and of its strip's place, until the returned
 *  function is called.  Frames after the pane has stopped being drawn are
 *  kept too, since that is where the neighbour used to snap. */
async function widths(tab: Page, testid: string, side: "left" | "right", other: string, strip: string) {
  await tab.evaluate(({ testid, side, other, strip }) => {
    const frames: Box[] = [];
    let running = true;
    const tick = () => {
      if (!running) return;
      const element = document.querySelector(`[data-testid="${testid}"]`) as HTMLElement | null;
      const neighbour = document.querySelector(`[data-testid="${other}"]`) as HTMLElement | null;
      const slot = document.querySelector(`[data-testid="${strip}"]`) as HTMLElement | null;
      const canvas = document.querySelector('[data-testid="preview-pane"] canvas') as HTMLCanvasElement | null;
      const style = element ? getComputedStyle(element) : null;
      const shown = !!(element && style && style.display !== "none");
      frames.push({
        width: shown ? element!.offsetWidth : 0,
        margin: shown ? parseFloat(side === "left" ? style!.marginLeft : style!.marginRight) : 0,
        other: neighbour?.offsetWidth ?? 0,
        strip: slot?.offsetWidth ?? 0,
        shown,
        canvas: canvas?.width ?? 0,
      });
      if (shown) last = performance.now();
      requestAnimationFrame(tick);
    };
    let last = performance.now();
    requestAnimationFrame(tick);
    const w = window as unknown as {
      __widths: () => typeof frames;
      __slid: () => boolean;
    };
    w.__widths = () => {
      running = false;
      return frames;
    };
    // The slide has begun, and has ended: the pane has stopped being drawn
    // (a fold hides it) or is back at its edge (an unfold).
    w.__slid = () => {
      const drawn = frames.filter((f) => f.shown);
      const moved = drawn.some((f) => f.margin !== 0);
      const at = frames[frames.length - 1];
      return moved && (performance.now() - last > 150 || (at !== undefined && at.shown && at.margin === 0));
    };
  }, { testid, side, other, strip });
  return async () => {
    // Until the slide has run, not for a fixed time. It was 700 ms, and
    // under a full run's load the click landed late enough that only the
    // slide's first frame fell inside the window (seen twice on 1 October
    // 2026). A slide that never starts still ends the wait, and fails the
    // checks after it.
    await tab
      .waitForFunction(() => (window as unknown as { __slid: () => boolean }).__slid(), null, {
        timeout: 5000,
      })
      .catch(() => undefined);
    await tab.waitForTimeout(100);
    return tab.evaluate(() => (window as unknown as { __widths: () => Box[] }).__widths());
  };
}

/** The writer saw the preview open a little past where it settles and then
 *  draw back, which made the panes feel jittery.  There were three causes,
 *  shared by the source pane: a transition on the pane's basis that
 *  overshot the hand over to its resting share, a width read after the
 *  neighbour had already squeezed it, and a zoomed page stretching the pane
 *  while its minimum was off.  Across a fold and an unfold the pane keeps
 *  one width, slides the whole of it, and its neighbour takes exactly the
 *  room it gives up. */
const PANES = {
  preview: {
    testid: "preview-pane", side: "right", other: "editor-pane", strip: "strip-slot-preview",
    fold: (tab: Page) => tab.getByLabel("Fold the preview away").click(),
    unfold: (tab: Page) => tab.getByTestId("collapsed-preview").click(),
  },
  source: {
    testid: "editor-pane", side: "left", other: "preview-pane", strip: "strip-slot-source",
    fold: (tab: Page) => tab.getByLabel("Fold the source away").click(),
    unfold: (tab: Page) => tab.getByTestId("collapsed-source").click(),
  },
} as const;

async function holdsItsWidth(tab: Page, which: keyof typeof PANES, zoom: string) {
  const { testid, side, other, strip, fold, unfold } = PANES[which];
  await tab.evaluate((zoom) => localStorage.setItem("nexttex.pdf.zoom", zoom), zoom);
  await tab.reload();
  await expect(tab.locator(".cm-editor")).toBeVisible({ timeout: 30_000 });
  await expect(tab.locator('[data-testid="preview-pane"] canvas').first()).toBeVisible({ timeout: 30_000 });
  const pane = tab.getByTestId(testid);
  const rest = await pane.evaluate((e) => (e as HTMLElement).offsetWidth);
  const row = await pane.evaluate((e, other) => (e as HTMLElement).offsetWidth
    + (document.querySelector(`[data-testid="${other}"]`) as HTMLElement).offsetWidth, other);

  for (const act of [fold, unfold]) {
    const stop = await widths(tab, testid, side, other, strip);
    await act(tab);
    const all = await stop();
    const frames = all.filter((f) => f.shown);
    const shown = all.map((f) => `${f.shown ? `${f.width}/${f.margin}` : "-"}/${f.other}/${f.strip}`).join(" ");
    expect(frames.length, shown).toBeGreaterThan(3);
    // Never wider or narrower than it rests.
    expect(frames.filter((f) => Math.abs(f.width - rest) > 1), shown).toHaveLength(0);
    // The slide covers the whole pane, so nothing is left to snap away.
    // Nearly, not exactly: under load the last frame of the slide can be
    // dropped, and a close is 140 ms, so one frame is a ninth of it.  The
    // fault this guards against stopped at two thirds.
    expect(Math.min(...frames.map((f) => f.margin)), shown).toBeLessThanOrEqual(-rest * 0.8);
    // The neighbour and the strip's place take up exactly what the pane
    // gives up.
    expect(frames.filter((f) => Math.abs(f.width + f.margin + f.other + f.strip - row) > 2), shown).toHaveLength(0);
    // The neighbour moves one way and stops, including in the frames after
    // the pane has gone: the strip used to arrive only then, and the
    // neighbour grew 28 px past where it settled and snapped back, or, on
    // the way in, jumped 28 px wider before the slide began.
    const others = all.map((f) => f.other);
    const way = Math.sign(others[others.length - 1] - others[0]);
    const back = others.slice(1).filter((w, i) => (w - others[i]) * way < -2);
    expect(back, shown).toHaveLength(0);
  }
  await expect(pane).toBeVisible();
  await expect.poll(() => pane.evaluate((e) => (e as HTMLElement).offsetWidth)).toBe(rest);
}

for (const zoom of ["0", "2.5"]) {
  test(`the preview keeps its width through a fold and back, at zoom ${zoom}`, async ({ tab }) => {
    await holdsItsWidth(tab, "preview", zoom);
  });
}

test("the source keeps its width through a fold and back", async ({ tab }) => {
  await holdsItsWidth(tab, "source", "0");
});

/** pdf.js drawing a page is tens of milliseconds a frame on a laptop, and
 *  the redraw for a new width used to start on a timer that guessed at the
 *  end of the move: under load it landed inside the slide, and otherwise
 *  300 ms after it, with the page stretched and soft until then.  While a
 *  pane slides, the page follows the width by its box alone, so its bitmap
 *  keeps the width it was drawn at; once the panes stop, it is drawn for
 *  the new width. */
test("the page is redrawn for its new width once the slide ends, not during it", async ({ tab }) => {
  await expect(tab.locator('[data-testid="preview-pane"] canvas').first()).toBeVisible({ timeout: 30_000 });
  const canvas = () => tab.evaluate(() =>
    (document.querySelector('[data-testid="preview-pane"] canvas') as HTMLCanvasElement).width);
  const before = await canvas();
  const stop = await widths(tab, "editor-pane", "left", "preview-pane", "strip-slot-source");
  await tab.getByLabel("Fold the source away").click();
  const all = await stop();
  const sliding = all.filter((f) => f.shown);
  const shown = all.map((f) => `${f.shown ? f.margin : "-"}:${f.canvas}`).join(" ");
  expect(sliding.length, shown).toBeGreaterThan(3);
  expect(sliding.filter((f) => f.canvas !== before), shown).toHaveLength(0);
  await expect.poll(canvas, { timeout: 5000 }).toBeGreaterThan(before * 1.5);
});
