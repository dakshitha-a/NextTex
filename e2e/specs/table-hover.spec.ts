import { test, expect } from "../fixtures";
import type { Page } from "@playwright/test";

/** A table renders on hover, like a formula.
 *
 *  Raised by the writer during the visual overhaul: resting the pointer
 *  inside a tabular opens the formula card with the table drawn as a
 *  table, the columns aligned as the spec says, the booktabs rules as
 *  rules, and maths in a cell set through KaTeX.  Hovering a formula
 *  inside a cell still shows the maths: it is the nearer thing.
 */

const TABLE = [
  "\\begin{tabular}{lcr}",
  "\\toprule",
  "Solvent & $\\varepsilon$ & $\\tau$ (ps) \\\\",
  "\\midrule",
  "Hexane & 1.9 & 12.4 \\\\",
  "Acetonitrile & 37.5 & 3.1 \\\\",
  "Water & 80.1 & 0.8 \\\\",
  "\\bottomrule",
  "\\end{tabular}",
];

/** The pixel of one character on the line holding `lineText`, the
 *  writing spec's way: a .cm-line is as wide as the pane, so hovering its
 *  middle hovers empty space past the text. */
async function pointAt(tab: Page, lineText: string, needle: string) {
  return tab.evaluate(({ lineText, needle }) => {
    const line = [...document.querySelectorAll(".cm-line")].find((el) => el.textContent?.includes(lineText));
    if (!line) return null;
    const target = line.textContent!.indexOf(needle) + 1;
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
  }, { lineText, needle });
}

/** Hover until the card is there, since CodeMirror refuses a hover whose
 *  pointer no longer resolves to the position it measured. */
async function hover(tab: Page, lineText: string, needle: string, card: string) {
  await expect.poll(async () => {
    await tab.mouse.move(5, 5);
    await tab.waitForTimeout(120);
    const point = await pointAt(tab, lineText, needle);
    if (!point) return 0;
    await tab.mouse.move(point.x - 4, point.y);
    await tab.mouse.move(point.x, point.y);
    await tab.mouse.move(point.x + 1, point.y);
    await tab.waitForTimeout(450);
    return tab.locator(card).count();
  }, { timeout: 15_000, intervals: [150] }).toBeGreaterThan(0);
  return tab.locator(card).first();
}

test.beforeEach(async ({ tab }) => {
  await tab.locator(".cm-content").click();
  await tab.keyboard.press("Control+End");
  await tab.keyboard.type("\n\n" + TABLE.join("\n"));
  await expect(tab.locator(".cm-line", { hasText: "Acetonitrile" })).toBeVisible();
});

test("hovering a cell draws the table, with the columns as the spec aligns them", async ({ tab }) => {
  const card = await hover(tab, "Acetonitrile", "Aceto", ".nx-table-tooltip");
  const table = card.locator("table.nx-table");
  await expect(table).toBeVisible();
  // Four rows of three cells; the first is the header, under a rule.
  await expect(table.locator("tr")).toHaveCount(4);
  await expect(table.locator("tr").first().locator("th")).toHaveCount(3);
  await expect(table.locator("tr").nth(2).locator("td")).toHaveCount(3);
  await expect(table.locator("tr").nth(2)).toContainText("Acetonitrile");
  await expect(table.locator("tr").nth(2).locator("td").nth(2)).toHaveClass(/nx-table-r/);
  await expect(table.locator("tr").first()).toHaveClass(/nx-table-rule/);
  await expect(table).toHaveClass(/nx-table-bottom/);
  // The maths in the header set by KaTeX, the mixed cell keeping its text.
  await expect(table.locator("th").nth(1).locator(".katex")).toBeVisible({ timeout: 15_000 });
  await expect(table.locator("th").nth(2)).toContainText("(ps)");
  // No source line under it: the source is in the editor under the card.
  await expect(card.locator(".nx-math-source")).toHaveCount(0);
  await expect(card).not.toContainText("\\begin{tabular}");
  await expect(card.locator(".nx-table-more")).toHaveCount(0);
});

test("hovering a formula inside a cell still shows the maths", async ({ tab }) => {
  const card = await hover(tab, "Solvent", "varepsilon", ".nx-math-tooltip");
  await expect(card).not.toHaveClass(/nx-table-tooltip/);
  await expect(card.locator(".nx-math-body")).toBeVisible();
  await expect(card.locator("table")).toHaveCount(0);
});

test("a table longer than the card draws says how many more rows there are", async ({ tab }) => {
  const rows = Array.from({ length: 34 }, (_, i) => `r${i} & ${i} \\\\`);
  await tab.keyboard.type("\n\n\\begin{tabular}{lr}\n" + rows.join("\n") + "\n\\end{tabular}");
  const card = await hover(tab, "r33", "r33", ".nx-table-tooltip");
  await expect(card.locator("table tr")).toHaveCount(30);
  await expect(card.locator(".nx-table-more")).toHaveText("and 4 more rows");
});
