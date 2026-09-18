import { test, expect } from "../fixtures";
import type { Page } from "@playwright/test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { png } from "../png";

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

test("a Ctrl-click on ordinary prose adds a caret there", async ({ tab }) => {
  // The modifier is the one CodeMirror reads for a second caret, so what
  // matters is that taking it for references does not swallow it
  // everywhere else. Multiple selections are on now (column selection
  // needs them), so a Ctrl-click off a link means what it means in every
  // other editor: a second caret, with the first left where it was. Two
  // lines, the caret on the second, and the click on the first, so both
  // lines end up active and one of them is the one clicked.
  await write(tab, "An ordinary sentence with no reference in it.");
  await tab.keyboard.type("\nAnd a second one, where the caret is now.");
  const point = await pointAt(tab, "An ordinary sentence", "ordinary");
  expect(point).not.toBeNull();
  await modifierClick(tab, point!);
  const active = tab.locator(".cm-activeLine");
  await expect(active).toHaveCount(2, { timeout: 10_000 });
  await expect(active.first()).toContainText("An ordinary sentence");
  await expect(active.last()).toContainText("And a second one");
  // And it is a caret, not a selection: typing lands on both lines. The
  // click point is somewhere inside the word, so only the line is asserted.
  await tab.keyboard.type("Z");
  await expect(active.first()).toHaveText(/^An o\w*Z\w* sentence with no reference in it\.$/);
  await expect(tab.locator(".cm-content")).toContainText("caret is now.Z");
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

test("after a build, hovering a reference says what it will say, and a figure shows itself", async ({
  project, tab,
}) => {
  /* The hover said the file and line; the writer wanted "Figure 1, on
     page 1", which every build writes into the .aux files.  The template
     builds on open, so the numbers are there by the time the tooltip is
     asked for; the place stays beneath the number. */
  writeFileSync(join(project.root, "figures", "plot.png"), png(40, 30));
  await write(tab, "Once more, \\ref{sec:results}, and \\includegraphics{figures/plot}.");
  // The editor refetches the symbols when a build lands, so the number is
  // in the browser a moment after the typed line's build; the tooltip is
  // asked for until it says so, rather than the server, which is ahead.
  const tip = tab.locator(".nx-link-tooltip");
  await expect.poll(async () => {
    await tab.mouse.move(5, 5);
    const ref = await pointAt(tab, "Once more", "sec:results");
    await tab.mouse.move(ref!.x, ref!.y);
    await tab.mouse.move(ref!.x + 1, ref!.y);
    await tip.waitFor({ timeout: 5_000 }).catch(() => undefined);
    return (await tip.textContent().catch(() => "")) ?? "";
  }, { timeout: 60_000, intervals: [1000] }).toMatch(/Section \d+, on page \d+/);
  await expect(tip).toContainText("main.tex, line");

  await tab.mouse.move(5, 5);
  await expect(tip).toHaveCount(0);
  const image = await pointAt(tab, "Once more", "figures/plot");
  await tab.mouse.move(image!.x, image!.y);
  await tab.mouse.move(image!.x + 1, image!.y);
  await expect(tab.locator(".nx-link-tooltip img")).toBeVisible({ timeout: 10_000 });
  await expect(tab.locator(".nx-link-tooltip")).toContainText("figures/plot.png");
  const natural = await tab.locator(".nx-link-tooltip img").evaluate(
    (el) => (el as HTMLImageElement).naturalWidth,
  );
  expect(natural).toBe(40);
});
