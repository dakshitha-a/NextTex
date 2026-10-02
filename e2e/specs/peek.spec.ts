import type { Page } from "@playwright/test";
import { test, expect } from "../fixtures";

/** Peeking at a drawer.
 *
 *  The writer asked for the bar to work two ways: resting the pointer on a
 *  button shows that drawer over whatever panes are open, in whatever
 *  arrangement, and a click docks it, contracting the panes, as before.
 *  The direction page's "Peeking at a drawer" draws it.  The peek is the
 *  overlay the drawer already is below 1100 px, at the docked width; it
 *  opens after the pointer has rested 200 ms, swaps at once along the bar,
 *  goes 300 ms after the pointer has left it and its button, and at once
 *  on Escape or a press outside.  A peek that has been clicked into stays.
 */

const peek = (tab: Page) => tab.getByTestId("drawer-peek");
const box = async (tab: Page, testid: string) => (await tab.getByTestId(testid).boundingBox())!;
/** The peek, once it has slid all the way out from under the bar. */
const settled = async (tab: Page) => {
  const bar = await box(tab, "activity-bar");
  await expect.poll(async () => Math.round((await box(tab, "drawer-peek")).x)).toBe(Math.round(bar.x + bar.width));
  return box(tab, "drawer-peek");
};
/** Somewhere over the source's text, clear of the bar and the peek. */
const away = async (tab: Page) => {
  const pane = await box(tab, "preview-pane");
  await tab.mouse.move(pane.x + pane.width / 2, pane.y + pane.height / 2);
};

test.beforeEach(async ({ tab }) => {
  await tab.setViewportSize({ width: 1600, height: 1000 });
  await expect(tab.locator(".cm-editor")).toBeVisible({ timeout: 30_000 });
  await expect(tab.getByTestId("drawer")).toHaveAttribute("data-drawer", "files");
});

test("resting on a bar button shows its drawer over the panes, which do not move", async ({ tab }) => {
  const before = await box(tab, "editor-pane");
  await tab.getByTestId("bar-sections").hover();
  await expect(peek(tab)).toBeVisible();
  await expect(peek(tab)).toHaveAttribute("data-drawer", "sections");
  // The docked drawer is still Files, and still docked.
  await expect(tab.getByTestId("drawer")).toHaveAttribute("data-drawer", "files");
  await expect(tab.getByTestId("bar-files")).toHaveAttribute("aria-pressed", "true");
  await expect(tab.getByTestId("bar-sections")).toHaveAttribute("aria-pressed", "false");
  await expect(tab.getByTestId("bar-sections")).toHaveAttribute("data-peeking", "true");
  // It lies over the column and the source from the bar's edge, at the
  // docked width, and nothing under it has moved.
  const bar = await box(tab, "activity-bar");
  const docked = await box(tab, "drawer");
  await expect.poll(async () => Math.round((await box(tab, "drawer-peek")).x)).toBe(Math.round(bar.x + bar.width));
  expect(Math.round((await box(tab, "drawer-peek")).width)).toBe(Math.round(docked.width));
  expect(await box(tab, "editor-pane")).toEqual(before);
});

test("it goes once the pointer has left the button and the peek", async ({ tab }) => {
  await tab.getByTestId("bar-sections").hover();
  // From the button into the peek keeps it.
  const p = await settled(tab);
  await tab.mouse.move(p.x + p.width / 2, p.y + 120, { steps: 4 });
  await tab.waitForTimeout(500);
  await expect(peek(tab)).toBeVisible();
  await away(tab);
  await expect(peek(tab)).toHaveCount(0);
});

test("along the bar the content changes at once, and a sweep opens nothing", async ({ tab }) => {
  // A quick pass down the bar opens no drawer.
  for (const id of ["sections", "search", "papers", "history", "git"]) {
    await tab.getByTestId(`bar-${id}`).hover();
    await tab.waitForTimeout(40);
  }
  await away(tab);
  await tab.waitForTimeout(400);
  await expect(peek(tab)).toHaveCount(0);

  await tab.getByTestId("bar-sections").hover();
  await expect(peek(tab)).toHaveAttribute("data-drawer", "sections");
  await tab.getByTestId("bar-history").hover();
  await expect(peek(tab)).toHaveAttribute("data-drawer", "history", { timeout: 150 });
});

test("resting on the docked drawer's own button shows nothing more", async ({ tab }) => {
  await tab.getByTestId("bar-files").hover();
  await tab.waitForTimeout(500);
  await expect(peek(tab)).toHaveCount(0);
});

test("a click docks the drawer being peeked at, and the panes make room", async ({ tab }) => {
  const before = await box(tab, "editor-pane");
  await tab.getByTestId("bar-history").hover();
  await expect(peek(tab)).toBeVisible();
  await tab.getByTestId("bar-history").click();
  await expect(tab.getByTestId("drawer")).toHaveAttribute("data-drawer", "history");
  await expect(tab.getByTestId("bar-history")).toHaveAttribute("aria-pressed", "true");
  await expect(peek(tab)).toHaveCount(0);
  // Files was docked at the same width, so the source is where it was.
  expect((await box(tab, "editor-pane")).x).toBeCloseTo(before.x, 0);

  // With the drawer folded, docking from a peek moves the panes over.
  await tab.getByTestId("bar-history").click();
  await expect(tab.getByTestId("drawer")).toHaveCount(0);
  await away(tab);
  const folded = await box(tab, "editor-pane");
  await tab.getByTestId("bar-sections").hover();
  await expect(peek(tab)).toBeVisible();
  expect(await box(tab, "editor-pane")).toEqual(folded);
  await tab.getByTestId("bar-sections").click();
  await expect(tab.getByTestId("drawer")).toHaveAttribute("data-drawer", "sections");
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

test("a peek that has been typed into stays when the pointer wanders off", async ({ tab }) => {
  await tab.getByTestId("bar-search").hover();
  await expect(peek(tab)).toHaveAttribute("data-drawer", "search");
  const field = peek(tab).getByRole("textbox").first();
  await field.click();
  await field.pressSequentially("conical");
  await away(tab);
  await tab.waitForTimeout(800);
  await expect(peek(tab)).toBeVisible();
  await expect(field).toHaveValue("conical");
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
  // and, holding focus, kept itself open as though it had been used.
  await tab.locator(".cm-content").click();
  await tab.getByTestId("bar-history").hover();
  await expect(peek(tab)).toHaveAttribute("data-drawer", "history");
  await tab.waitForTimeout(300);
  await expect.poll(() => tab.evaluate(() => !!document.activeElement?.closest(".cm-editor"))).toBe(true);
  await away(tab);
  await expect(peek(tab)).toHaveCount(0);
});
