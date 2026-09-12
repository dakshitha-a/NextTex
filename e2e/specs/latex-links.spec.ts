import { test, expect } from "../fixtures";
import type { Page } from "@playwright/test";

/** R-085. A thesis is a graph held together by \ref, \input and \cite, and
 *  none of the three went anywhere. */

/** The middle of one token on screen. A `.cm-line` is as wide as the pane,
 *  so clicking its middle clicks empty space past the text; this is the
 *  pattern `writing.spec.ts` uses to hover an equation. */
async function pointAt(page: Page, contains: string, token: string) {
  return page.evaluate(
    ({ contains, token }) => {
      const line = [...document.querySelectorAll(".cm-line")].find((el) =>
        el.textContent?.includes(contains),
      );
      if (!line) return null;
      const target = line.textContent!.indexOf(token) + Math.floor(token.length / 2);
      const walker = document.createTreeWalker(line, NodeFilter.SHOW_TEXT);
      let seen = 0;
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        const length = node.textContent!.length;
        if (seen + length > target) {
          const range = document.createRange();
          range.setStart(node, target - seen);
          range.setEnd(node, target - seen + 1);
          const box = range.getBoundingClientRect();
          return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
        }
        seen += length;
      }
      return null;
    },
    { contains, token },
  );
}

/** Written at the end of the document rather than found in the template.
 *
 *  CodeMirror renders only the lines on screen, and the template's own
 *  `\ref` and `\cite` are forty lines above the fold, so there is no
 *  element to point at until something scrolls them into view. Typing
 *  scrolls the caret into view, which is what `writing.spec.ts` relies on
 *  for the same reason. The brace pairs itself and typing the closing one
 *  steps over it, so what lands is exactly what is typed. */
async function write(page: Page, text: string) {
  await expect(page.locator(".cm-editor")).toBeVisible({ timeout: 30_000 });
  await page.locator(".cm-content").click();
  await page.keyboard.press("Control+End");
  await page.keyboard.type(`\n${text}`);
  await expect(page.locator(".cm-line", { hasText: text })).toBeVisible();
}

async function modifierClick(page: Page, point: { x: number; y: number }) {
  await page.keyboard.down("Control");
  await page.mouse.click(point.x, point.y);
  await page.keyboard.up("Control");
}

test("Ctrl-clicking a reference goes to the label", async ({ tab }) => {
  await write(tab, "Back to \\ref{sec:results} again.");
  const point = await pointAt(tab, "Back to", "sec:results");
  expect(point).not.toBeNull();
  await modifierClick(tab, point!);

  // The line the caret is on, read off the editor's own active-line
  // decoration rather than by counting lines in `innerText`: CodeMirror
  // renders only what is on screen, so line seventeen of the text on the
  // page is not line seventeen of the document.
  await expect(tab.locator(".cm-activeLine")).toContainText("\\label{sec:results}", {
    timeout: 10_000,
  });
});

test("a Ctrl-click on ordinary prose is an ordinary click", async ({ tab }) => {
  // The modifier is the one CodeMirror reads for a second cursor, so what
  // matters is that taking it for references does not swallow it
  // everywhere else. This editor does not enable multiple selections, so
  // an ordinary click is all there is to be left alone.
  // Two lines, and the caret left on the second, so moving it to the
  // first is something the click has to have done.
  await write(tab, "An ordinary sentence with no reference in it.");
  await tab.keyboard.type("\nAnd a second one, where the caret is now.");
  const point = await pointAt(tab, "An ordinary sentence", "ordinary");
  expect(point).not.toBeNull();
  await modifierClick(tab, point!);
  await expect(tab.locator(".cm-activeLine")).toContainText("An ordinary sentence", {
    timeout: 10_000,
  });
});

test("hovering a citation shows who wrote it", async ({ tab }) => {
  await write(tab, "As shown in \\cite{knuth1984}.");
  const point = await pointAt(tab, "As shown in", "knuth1984");
  expect(point).not.toBeNull();
  await tab.mouse.move(point!.x, point!.y);
  await tab.mouse.move(point!.x + 1, point!.y);
  const tip = tab.locator(".nx-link-tooltip");
  await expect(tip).toBeVisible({ timeout: 10_000 });
  await expect(tip).toContainText("Knuth");
});

test("hovering a reference says where it goes and how to get there", async ({
  tab,
}) => {
  await write(tab, "Once more, \\ref{sec:results}.");
  const point = await pointAt(tab, "Once more", "sec:results");
  expect(point).not.toBeNull();
  await tab.mouse.move(point!.x, point!.y);
  await tab.mouse.move(point!.x + 1, point!.y);
  const tip = tab.locator(".nx-link-tooltip");
  await expect(tip).toBeVisible({ timeout: 10_000 });
  await expect(tip).toContainText("main.tex, line");
  await expect(tip).toContainText(/click to go there/);
});

test("a reference to a label that is not there says so rather than jumping", async ({
  tab,
}) => {
  await write(tab, "A dangling \\ref{sec:nowhere}.");
  const point = await pointAt(tab, "A dangling", "sec:nowhere");
  await tab.mouse.move(point!.x, point!.y);
  await tab.mouse.move(point!.x + 1, point!.y);
  await expect(tab.locator(".nx-link-tooltip")).toContainText("No \\label", {
    timeout: 10_000,
  });
});
