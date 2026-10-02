import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Page } from "@playwright/test";
import { test, expect } from "../fixtures";
import { png } from "../png";

/** Peeking at a drawer.
 *
 *  The writer asked for the bar to work two ways: resting the pointer on a
 *  button shows that drawer over whatever panes are open, in whatever
 *  arrangement, and a click docks it, contracting the panes, as before.
 *  The direction page's "Peeking at a drawer" draws it.  The peek is the
 *  overlay the drawer already is below 1100 px, at the docked width.  Over
 *  a folded drawer it slides out from under the bar, which stays on top of
 *  it; over a drawer that is showing it is there and gone at once.  It
 *  opens after the pointer has rested 120 ms, swaps at once along the bar,
 *  goes 150 ms after the pointer has left it and its button, at once on
 *  Escape or a press outside, and stays only while it is typed into.
 */

const peek = (tab: Page) => tab.getByTestId("drawer-peek");
const box = async (tab: Page, testid: string) => (await tab.getByTestId(testid).boundingBox())!;
/** The peek, once it has slid all the way out from under the bar. */
const settled = async (tab: Page) => {
  const bar = await box(tab, "activity-bar");
  await expect.poll(async () => Math.round((await box(tab, "drawer-peek")).x)).toBe(Math.round(bar.x + bar.width));
  return box(tab, "drawer-peek");
};
/** Somewhere over the preview, clear of the bar and the peek. */
const away = async (tab: Page) => {
  const pane = await box(tab, "preview-pane");
  await tab.mouse.move(pane.x + pane.width / 2, pane.y + pane.height / 2);
};
/** Fold the docked drawer away. */
const fold = async (tab: Page) => {
  await tab.getByTestId("bar-files").click();
  await expect(tab.getByTestId("drawer")).toHaveCount(0);
  await away(tab);
};
/** The peek's left edge on every frame until the returned function is
 *  called, to tell a slide from an appearance. */
async function edges(tab: Page) {
  await tab.evaluate(() => {
    const w = window as unknown as { __x: number[]; __go: boolean };
    w.__x = [];
    w.__go = true;
    const tick = () => {
      const el = document.querySelector('[data-testid="drawer-peek"]');
      if (el) w.__x.push(Math.round(el.getBoundingClientRect().x));
      if (w.__go) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  return () => tab.evaluate(() => {
    const w = window as unknown as { __x: number[]; __go: boolean };
    w.__go = false;
    return w.__x;
  });
}

test.beforeEach(async ({ tab }) => {
  await tab.setViewportSize({ width: 1600, height: 1000 });
  await expect(tab.locator(".cm-editor")).toBeVisible({ timeout: 30_000 });
  await expect(tab.getByTestId("drawer")).toHaveAttribute("data-drawer", "files");
});

test("over a docked drawer the peek is there at once, without a slide, and the panes do not move", async ({ tab }) => {
  const before = await box(tab, "editor-pane");
  const stop = await edges(tab);
  await tab.getByTestId("bar-sections").hover();
  await expect(peek(tab)).toHaveAttribute("data-drawer", "sections");
  await tab.waitForTimeout(200);
  const xs = await stop();
  const bar = await box(tab, "activity-bar");
  expect(xs.length).toBeGreaterThan(0);
  expect(xs.filter((x) => x !== Math.round(bar.x + bar.width)), xs.join(" ")).toHaveLength(0);
  // The docked drawer is still Files, and still docked.
  await expect(tab.getByTestId("drawer")).toHaveAttribute("data-drawer", "files");
  await expect(tab.getByTestId("bar-files")).toHaveAttribute("aria-pressed", "true");
  await expect(tab.getByTestId("bar-sections")).toHaveAttribute("data-peeking", "true");
  expect(Math.round((await box(tab, "drawer-peek")).width)).toBe(Math.round((await box(tab, "drawer")).width));
  expect(await box(tab, "editor-pane")).toEqual(before);
  // And it goes at once.
  await away(tab);
  await tab.waitForTimeout(170);
  await expect(peek(tab)).toHaveCount(0);
});

test("resting on the docked drawer's own button shows nothing more", async ({ tab }) => {
  await tab.getByTestId("bar-files").hover();
  await tab.waitForTimeout(400);
  await expect(peek(tab)).toHaveCount(0);
});

test("over a folded drawer the peek slides out from under the bar, which stays clear", async ({ tab }) => {
  await fold(tab);
  const before = await box(tab, "editor-pane");
  const button = await box(tab, "bar-search");
  await tab.evaluate(({ x, y }) => {
    const w = window as unknown as { __over: string[]; __go: boolean };
    w.__over = [];
    w.__go = true;
    const tick = () => {
      const hit = document.elementFromPoint(x, y)?.closest("[data-testid]")?.getAttribute("data-testid") ?? "";
      if (document.querySelector('[data-testid="drawer-peek"]')) w.__over.push(hit);
      if (w.__go) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }, { x: button.x + button.width / 2, y: button.y + button.height / 2 });
  const stop = await edges(tab);
  await tab.getByTestId("bar-sections").hover();
  await settled(tab);
  const xs = await stop();
  const over = await tab.evaluate(() => {
    const w = window as unknown as { __over: string[]; __go: boolean };
    w.__go = false;
    return w.__over;
  });
  // It slid, and every frame of the slide the bar's own button was what
  // lay under its middle: the peek passes beneath the bar, never over it.
  expect(xs.some((x) => x < xs[xs.length - 1] - 20), xs.join(" ")).toBe(true);
  expect(over.filter((hit) => hit !== "bar-search"), over.join(" ")).toHaveLength(0);
  expect(await box(tab, "editor-pane")).toEqual(before);
});

test("it goes once the pointer has left the button and the peek", async ({ tab }) => {
  await fold(tab);
  await tab.getByTestId("bar-sections").hover();
  // From the button into the peek keeps it.
  const p = await settled(tab);
  await tab.mouse.move(p.x + p.width / 2, p.y + 120, { steps: 4 });
  await tab.waitForTimeout(400);
  await expect(peek(tab)).toBeVisible();
  await away(tab);
  await expect(peek(tab)).toHaveCount(0);
});

test("opening a folder and resting on a picture in the peek does not keep it", async ({ tab, project }) => {
  // The writer's report: after a figure's card in the peeked file tree,
  // the peek would not go.  Any press used to hold it, and reaching the
  // figure meant pressing its folder open.
  mkdirSync(join(project.root, "figures"), { recursive: true });
  writeFileSync(join(project.root, "figures", "small.png"), png(120, 80));
  await fold(tab);
  await tab.getByTestId("bar-files").hover();
  await settled(tab);
  await peek(tab).locator('[role="tree"] [data-path="figures"]').click();
  await peek(tab).locator('[role="tree"] [data-path="figures/small.png"]').hover();
  await tab.waitForTimeout(700);
  await away(tab);
  await expect(peek(tab)).toHaveCount(0);
});

test("along the bar the content changes at once, and a sweep opens nothing", async ({ tab }) => {
  await fold(tab);
  for (const id of ["sections", "search", "papers", "history", "git"]) {
    await tab.getByTestId(`bar-${id}`).hover();
    await tab.waitForTimeout(30);
  }
  await away(tab);
  await tab.waitForTimeout(300);
  await expect(peek(tab)).toHaveCount(0);

  await tab.getByTestId("bar-sections").hover();
  await expect(peek(tab)).toHaveAttribute("data-drawer", "sections");
  await tab.getByTestId("bar-history").hover();
  await expect(peek(tab)).toHaveAttribute("data-drawer", "history", { timeout: 150 });
});

test("a click docks the drawer being peeked at, and the panes make room", async ({ tab }) => {
  // Over a docked drawer: the docked one becomes the peeked one.
  await tab.getByTestId("bar-history").hover();
  await expect(peek(tab)).toBeVisible();
  await tab.getByTestId("bar-history").click();
  await expect(tab.getByTestId("drawer")).toHaveAttribute("data-drawer", "history");
  await expect(peek(tab)).toHaveCount(0);

  // Over a folded one: the panes slide over.
  await tab.getByTestId("bar-history").click();
  await expect(tab.getByTestId("drawer")).toHaveCount(0);
  await away(tab);
  const folded = await box(tab, "editor-pane");
  await tab.getByTestId("bar-sections").hover();
  await expect(peek(tab)).toBeVisible();
  expect(await box(tab, "editor-pane")).toEqual(folded);
  await tab.getByTestId("bar-sections").click();
  await expect(tab.getByTestId("drawer")).toHaveAttribute("data-drawer", "sections");
  await expect(tab.getByTestId("bar-sections")).toHaveAttribute("aria-pressed", "true");
  await expect(peek(tab)).toHaveCount(0);
  await expect.poll(async () => (await box(tab, "editor-pane")).x).toBeGreaterThan(folded.x + 100);
});

test("Escape, or a press outside it, puts the peek away at once", async ({ tab }) => {
  await tab.getByTestId("bar-sections").hover();
  await expect(peek(tab)).toBeVisible();
  await tab.keyboard.press("Escape");
  await expect(peek(tab)).toHaveCount(0);

  await away(tab);
  await tab.getByTestId("bar-sections").hover();
  await expect(peek(tab)).toBeVisible();
  const pane = await box(tab, "preview-pane");
  await tab.mouse.click(pane.x + pane.width / 2, pane.y + pane.height / 2);
  await expect(peek(tab)).toHaveCount(0);
  await expect(tab.getByTestId("drawer")).toHaveAttribute("data-drawer", "files");
});

test("a peek that is being typed into stays when the pointer wanders off", async ({ tab }) => {
  await tab.getByTestId("bar-search").hover();
  await expect(peek(tab)).toHaveAttribute("data-drawer", "search");
  const field = peek(tab).getByRole("textbox").first();
  await field.click();
  await field.pressSequentially("conical");
  await away(tab);
  await tab.waitForTimeout(600);
  await expect(peek(tab)).toBeVisible();
  await expect(field).toHaveValue("conical");
});

test("a drawer brought back another way ends the peek", async ({ tab }) => {
  await fold(tab);
  await tab.getByTestId("bar-sections").hover();
  await expect(peek(tab)).toBeVisible();
  await tab.keyboard.press("Control+b");
  await expect(tab.getByTestId("drawer")).toBeVisible();
  await expect(peek(tab)).toHaveCount(0);
});

test("below 1100 px the bar peeks the same way", async ({ tab }) => {
  await tab.setViewportSize({ width: 1000, height: 800 });
  await expect(tab.getByTestId("drawer")).toHaveCount(0);
  const before = await box(tab, "editor-pane");
  await tab.getByTestId("bar-sections").hover();
  await expect(peek(tab)).toHaveAttribute("data-drawer", "sections");
  expect(await box(tab, "editor-pane")).toEqual(before);
  await away(tab);
  await expect(peek(tab)).toHaveCount(0);
});

test("a peek leaves the caret in the source, even at a drawer that focuses itself", async ({ tab }) => {
  // History takes the keyboard as it mounts, which docked is what a click
  // on its button asks for; peeked at, it took the caret out of the source
  // and, holding focus, kept itself open.
  await tab.locator(".cm-content").click();
  await tab.getByTestId("bar-history").hover();
  await expect(peek(tab)).toHaveAttribute("data-drawer", "history");
  await tab.waitForTimeout(300);
  await expect.poll(() => tab.evaluate(() => !!document.activeElement?.closest(".cm-editor"))).toBe(true);
  await away(tab);
  await expect(peek(tab)).toHaveCount(0);
});

test("a peek at Files shows the tree as the docked drawer left it", async ({ tab, project }) => {
  // Each tree kept its own open folders, so the peek showed every folder
  // shut after the writer had opened them in the docked drawer.
  mkdirSync(join(project.root, "figures"), { recursive: true });
  writeFileSync(join(project.root, "figures", "small.png"), png(120, 80));
  const docked = tab.getByTestId("drawer").locator('[role="tree"] [data-path="figures"]');
  await docked.click();
  await expect(docked).toHaveAttribute("aria-expanded", "true");
  await fold(tab);
  await tab.getByTestId("bar-files").hover();
  await settled(tab);
  await expect(peek(tab).locator('[role="tree"] [data-path="figures"]')).toHaveAttribute("aria-expanded", "true");
  await expect(peek(tab).locator('[role="tree"] [data-path="figures/small.png"]')).toBeVisible();
});
