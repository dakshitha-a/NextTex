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
