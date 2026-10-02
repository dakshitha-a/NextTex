import type { Page } from "@playwright/test";
import { test, expect } from "../fixtures";

/** The Claude column peeks from the window's right edge.
 *
 *  The writer asked that, in whatever view, the pointer pushed past the
 *  window's right edge, past any scrollbar there, brings the agent's
 *  column in over the panes; it docks only by its shortcut, its button or
 *  its strip.  It comes and goes at the drawer peek's pace, goes once the
 *  pointer leaves it, at once on Escape or a press outside, and stays
 *  while it is typed into. */

const column = (tab: Page) => tab.getByTestId("chat-panel");
const peeking = (tab: Page) => tab.locator('[data-testid="chat-panel"][data-peeking]');
const edge = async (tab: Page) => {
  const width = await tab.evaluate(() => window.innerWidth);
  await tab.mouse.move(width - 200, 500);
  await tab.mouse.move(width - 1, 500, { steps: 4 });
};
const middle = (tab: Page) => tab.mouse.move(600, 500);

test.beforeEach(async ({ tab }) => {
  await tab.setViewportSize({ width: 1600, height: 1000 });
  await expect(tab.locator(".cm-editor")).toBeVisible({ timeout: 30_000 });
  await expect(column(tab)).toBeVisible();
});

test("with the column folded, the right edge slides it in over the panes, which do not move", async ({ tab }) => {
  await tab.keyboard.press("Control+Alt+a");
  await expect(column(tab)).toBeHidden();
  await middle(tab);
  const preview = await tab.getByTestId("preview-pane").boundingBox();
  await edge(tab);
  await expect(peeking(tab)).toBeVisible();
  const width = await tab.evaluate(() => window.innerWidth);
  await expect.poll(async () => Math.round((await column(tab).boundingBox())!.x + (await column(tab).boundingBox())!.width)).toBe(width);
  expect(await tab.getByTestId("preview-pane").boundingBox()).toEqual(preview);
  // It does not dock: the strip is still there under it.
  await expect(tab.getByTestId("collapsed-claude")).toHaveCount(1);
  await middle(tab);
  await expect(peeking(tab)).toHaveCount(0);
  await expect(column(tab)).toBeHidden();
});

test("with the column docked, the edge does nothing", async ({ tab }) => {
  await edge(tab);
  await tab.waitForTimeout(400);
  await expect(peeking(tab)).toHaveCount(0);
});

test("a pointer near the edge but not at it, or a drag to it, brings nothing", async ({ tab }) => {
  await tab.keyboard.press("Control+Alt+a");
  await middle(tab);
  const width = await tab.evaluate(() => window.innerWidth);
  await tab.mouse.move(width - 12, 500);
  await tab.waitForTimeout(400);
  await expect(peeking(tab)).toHaveCount(0);
  await tab.mouse.move(600, 500);
  await tab.mouse.down();
  await tab.mouse.move(width - 1, 500, { steps: 4 });
  await tab.waitForTimeout(400);
  await tab.mouse.up();
  await expect(peeking(tab)).toHaveCount(0);
});

test("Escape or a press outside puts it away, and typing in it keeps it", async ({ tab }) => {
  await tab.keyboard.press("Control+Alt+a");
  await middle(tab);
  await edge(tab);
  await expect(peeking(tab)).toBeVisible();
  await tab.keyboard.press("Escape");
  await expect(peeking(tab)).toHaveCount(0);

  await middle(tab);
  await edge(tab);
  await expect(peeking(tab)).toBeVisible();
  const box = column(tab).locator("textarea");
  await box.click();
  await box.pressSequentially("Is the abstract too long?");
  await middle(tab);
  await tab.waitForTimeout(500);
  await expect(peeking(tab)).toBeVisible();
  await tab.mouse.click(600, 500);
  await expect(peeking(tab)).toHaveCount(0);
});

test("the shortcut docks it from a peek", async ({ tab }) => {
  await tab.keyboard.press("Control+Alt+a");
  await middle(tab);
  await edge(tab);
  await expect(peeking(tab)).toBeVisible();
  await tab.keyboard.press("Control+Alt+a");
  await expect(peeking(tab)).toHaveCount(0);
  await expect(column(tab)).toBeVisible();
  await expect(tab.getByTestId("collapsed-claude")).toHaveCount(0);
});

test("on a narrow window the parked column peeks from the edge the same way", async ({ tab }) => {
  await tab.setViewportSize({ width: 1200, height: 800 });
  await expect(column(tab)).toHaveAttribute("aria-hidden", "true");
  await middle(tab);
  await edge(tab);
  await expect(peeking(tab)).toBeVisible();
  await expect(column(tab)).not.toHaveAttribute("aria-hidden", "true");
  await middle(tab);
  await expect(peeking(tab)).toHaveCount(0);
  await expect(column(tab)).toHaveAttribute("aria-hidden", "true");
});
