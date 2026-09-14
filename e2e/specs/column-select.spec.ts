import { test, expect } from "../fixtures";
import type { Page } from "@playwright/test";

/** Selecting a column, which is what editing a table by hand needs.
 *
 *  `rectangularSelection()` had been installed for a year and did nothing:
 *  the editor never allowed more than one selection range, so every
 *  column drag collapsed to its main range before it was drawn.
 */

const ROWS = ["a & 1 \\\\", "b & 2 \\\\", "c & 3 \\\\", "d & 4 \\\\"];

/** Replace the document with a four-row table body and put the caret at
 *  its start. */
async function table(tab: Page) {
  await expect(tab.locator(".cm-editor")).toBeVisible({ timeout: 30_000 });
  await tab.locator(".cm-content").click();
  await tab.keyboard.press("Control+a");
  await tab.keyboard.type(ROWS.join("\n"));
  await expect(tab.locator(".cm-line").first()).toHaveText(ROWS[0]);
  await tab.keyboard.press("Control+Home");
}

/** The viewport point of a character on a line, so a drag can start and
 *  end on a column rather than on a pixel guessed from the font size. */
async function at(tab: Page, line: number, column: number) {
  const point = await tab.evaluate(
    ({ line, column }) => {
      const row = document.querySelectorAll(".cm-line")[line] as HTMLElement;
      const walker = document.createTreeWalker(row, NodeFilter.SHOW_TEXT);
      let seen = 0;
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        const length = node.textContent!.length;
        if (seen + length > column) {
          const range = document.createRange();
          range.setStart(node, column - seen);
          range.setEnd(node, column - seen);
          const box = range.getBoundingClientRect();
          return { x: box.x, y: box.y + box.height / 2 };
        }
        seen += length;
      }
      return null;
    },
    { line, column },
  );
  expect(point).not.toBeNull();
  return point!;
}

const lines = (tab: Page) =>
  tab.locator(".cm-line").evaluateAll((rows) => rows.map((r) => r.textContent));

test("Alt-drag selects a column and typing lands on every row", async ({ tab }) => {
  await table(tab);
  const from = await at(tab, 0, 2);
  const to = await at(tab, 3, 2);
  await tab.keyboard.down("Alt");
  await tab.mouse.move(from.x, from.y);
  await tab.mouse.down();
  await tab.mouse.move(to.x, to.y, { steps: 6 });
  await tab.mouse.up();
  await tab.keyboard.up("Alt");
  await tab.keyboard.type("X");
  expect(await lines(tab)).toEqual(ROWS.map((r) => r.slice(0, 2) + "X" + r.slice(2)));
});

test("the crosshair says what Alt is about to do", async ({ tab }) => {
  await table(tab);
  const cursor = () =>
    tab.locator(".cm-content").evaluate((el) => getComputedStyle(el).cursor);
  await tab.keyboard.down("Alt");
  await expect.poll(cursor).toBe("crosshair");
  await tab.keyboard.up("Alt");
  await expect.poll(cursor).not.toBe("crosshair");
});

test("Ctrl-Shift-Alt-Down adds a caret on the row below, and Escape takes them away", async ({
  tab,
}) => {
  // The keyboard route, for a desktop whose window manager takes Alt-drag
  // before the browser sees it.  CodeMirror's own Ctrl-Alt-Down does the
  // same thing, and GNOME takes that one for workspaces on many installs.
  await table(tab);
  await tab.keyboard.press("ArrowRight");
  await tab.keyboard.press("ArrowRight");
  await tab.keyboard.press("Control+Shift+Alt+ArrowDown");
  await tab.keyboard.press("Control+Shift+Alt+ArrowDown");
  await tab.keyboard.press("Control+Shift+Alt+ArrowDown");
  await tab.keyboard.type("X");
  expect(await lines(tab)).toEqual(ROWS.map((r) => r.slice(0, 2) + "X" + r.slice(2)));

  // The completion source is asked 100 ms after a keystroke, and an Escape
  // inside that window closes the query rather than the cursors, which is
  // CodeMirror's own rule.  Nobody presses Escape that fast; the test
  // must not either.
  await tab.waitForTimeout(300);
  await tab.keyboard.press("Escape");
  await tab.keyboard.type("Y");
  const after = await lines(tab);
  expect(after.filter((r) => r!.includes("Y"))).toHaveLength(1);
});
