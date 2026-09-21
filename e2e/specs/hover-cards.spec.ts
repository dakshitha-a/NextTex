import { test, expect } from "../fixtures";
import type { Page } from "@playwright/test";

/** The editor's hover cards are a choice, by kind.
 *
 *  Raised by the writer after 3.3.0: a toggle for the hover previews, and
 *  control over which kinds get one.  Two rows on the settings sheet's
 *  While you write group: a switch called Hover cards, and while it is
 *  on a row of toggle chips, one per kind.  The switch off says what
 *  still happens; a kind off reaches inside a reference's card, which
 *  draws the thing it points at only while that thing's own kind is on.
 */

/** The middle of one token on the line holding `contains`, the pattern
 *  the other hover specs use: a .cm-line is as wide as the pane, so
 *  hovering its middle hovers empty space past the text. */
async function pointAt(tab: Page, contains: string, token: string) {
  return tab.evaluate(({ contains, token }) => {
    const line = [...document.querySelectorAll(".cm-line")].find((el) => el.textContent?.includes(contains));
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
  }, { contains, token });
}

async function write(tab: Page, text: string) {
  await expect(tab.locator(".cm-editor")).toBeVisible({ timeout: 30_000 });
  await tab.locator(".cm-content").click();
  await tab.keyboard.press("Control+End");
  await tab.keyboard.type(`\n${text}`);
  await expect(tab.locator(".cm-line", { hasText: text })).toBeVisible();
}

/** One hover attempt: away, then onto the token, then a nudge, then the
 *  250 ms the card waits and some more. */
async function hoverOnce(tab: Page, contains: string, token: string) {
  await tab.mouse.move(5, 5);
  await tab.waitForTimeout(150);
  const point = await pointAt(tab, contains, token);
  if (!point) return false;
  await tab.mouse.move(point.x - 4, point.y);
  await tab.mouse.move(point.x, point.y);
  await tab.mouse.move(point.x + 1, point.y);
  await tab.waitForTimeout(600);
  return true;
}

/** Hovered again until the card holds `ready`, since CodeMirror refuses
 *  a hover whose pointer no longer resolves to the position it measured,
 *  and the scan that gives a label its environment lands a moment after
 *  the typing. */
async function cardFor(tab: Page, contains: string, token: string, ready: string) {
  await expect.poll(async () => {
    if (!(await hoverOnce(tab, contains, token))) return 0;
    return tab.locator(ready).count();
  }, { timeout: 30_000, intervals: [500] }).toBeGreaterThan(0);
  return tab.locator(ready).first();
}

/** No card, tried three times: a single refused hover would prove
 *  nothing, and three accepted ones with nothing drawn prove the gate. */
async function noCardFor(tab: Page, contains: string, token: string) {
  for (let attempt = 0; attempt < 3; attempt++) {
    expect(await hoverOnce(tab, contains, token)).toBe(true);
    await expect(tab.locator(".nx-math-tooltip")).toHaveCount(0);
  }
}

async function openWrite(tab: Page) {
  await tab.getByTestId("appearance").first().click();
  const sheet = tab.getByRole("dialog", { name: "Settings" });
  await expect(sheet).toBeVisible();
  await sheet.getByRole("tab", { name: /While you write/ }).click();
  await expect(sheet.getByTestId("hover-cards")).toBeVisible();
  return sheet;
}

async function closeSheet(tab: Page) {
  await tab.getByRole("dialog", { name: "Settings" }).getByRole("button", { name: "Done" }).click();
  await expect(tab.getByRole("dialog", { name: "Settings" })).toHaveCount(0);
}

test("the switch turns every card off, says what still works, and is remembered", async ({ tab }) => {
  await write(tab, "A gap of $E = mc^2$ appears.");
  await write(tab, "Once more, \\ref{sec:results}.");
  // On by default: the formula card comes.
  const card = await cardFor(tab, "A gap of", "mc^2", ".nx-math-tooltip");
  await expect(card).toBeVisible();

  const sheet = await openWrite(tab);
  const toggle = sheet.getByTestId("hover-cards");
  await expect(toggle).toHaveAttribute("aria-checked", "true");
  // Every chip on, and Show for present, while the switch is on.
  await expect(sheet.getByTestId("hover-kinds")).toBeVisible();
  for (const kind of ["maths", "tables", "figures", "refs", "cites", "files"]) {
    await expect(sheet.getByTestId(`hover-${kind}`)).toHaveAttribute("aria-pressed", "true");
  }
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-checked", "false");
  // The off sentence, and the chips gone with the switch.
  await expect(sheet).toContainText(/still follows a reference or a file/);
  await expect(sheet.getByTestId("hover-kinds")).toHaveCount(0);
  await closeSheet(tab);

  // No card of any kind, on the next hover, with no reload.
  await noCardFor(tab, "A gap of", "mc^2");
  await noCardFor(tab, "Once more", "sec:results");

  // What the sentence promised: Ctrl-click still follows the reference.
  const point = await pointAt(tab, "Once more", "sec:results");
  expect(point).not.toBeNull();
  await tab.keyboard.down("Control");
  await tab.mouse.click(point!.x, point!.y);
  await tab.keyboard.up("Control");
  await expect(tab.locator(".cm-activeLine")).toContainText("\\label{sec:results}", { timeout: 10_000 });

  // Remembered per browser.
  await tab.reload();
  const again = await openWrite(tab);
  await expect(again.getByTestId("hover-cards")).toHaveAttribute("aria-checked", "false");
  await expect(again.getByTestId("hover-kinds")).toHaveCount(0);
});

test("one kind off leaves the others, reaches inside a reference's card, and a reset brings it back", async ({ tab }) => {
  await write(tab, "\\begin{equation}E = mc^2 \\label{eq:mass}\\end{equation}");
  await write(tab, "\\begin{tabular}{lr}\\toprule Solvent & Rate \\\\ \\midrule Water & 0.8 \\\\ \\bottomrule\\end{tabular}");
  await write(tab, "See \\eqref{eq:mass} and a gap of $E = mc^2$ here.");

  const sheet = await openWrite(tab);
  const maths = sheet.getByTestId("hover-maths");
  await expect(maths).toHaveAttribute("aria-pressed", "true");
  await maths.click();
  await expect(maths).toHaveAttribute("aria-pressed", "false");
  // The switch stays on: one kind is a chip, not the whole.
  await expect(sheet.getByTestId("hover-cards")).toHaveAttribute("aria-checked", "true");
  await closeSheet(tab);

  // The formula card is gone; the table card is not.
  await noCardFor(tab, "See \\eqref", "mc^2");
  const table = await cardFor(tab, "Water", "Water", ".nx-table-tooltip");
  await expect(table.locator("table.nx-table")).toContainText("Water");
  await tab.mouse.move(5, 5);
  await expect(tab.locator(".nx-table-tooltip")).toHaveCount(0);

  // The reference's card still comes, with its place, but with Equations
  // off it does not typeset the equation under its line.
  await cardFor(tab, "See \\eqref", "eq:mass", ".nx-link-tooltip .nx-link-place");
  await expect(tab.locator(".nx-link-tooltip .nx-link-place")).toHaveText(/^main\.tex:\d+$/);
  await tab.waitForTimeout(1_500);
  await expect(tab.locator(".nx-link-tooltip .katex")).toHaveCount(0);
  await tab.mouse.move(5, 5);

  // Remembered, then reset with the rest of this computer's choices.
  await tab.reload();
  const again = await openWrite(tab);
  await expect(again.getByTestId("hover-maths")).toHaveAttribute("aria-pressed", "false");
  await again.getByRole("button", { name: /Reset this computer/ }).click();
  await expect(again.getByTestId("hover-maths")).toHaveAttribute("aria-pressed", "true");
  await closeSheet(tab);
  await write(tab, "And a gap of $a^2 + b^2$ again.");
  const back = await cardFor(tab, "And a gap of", "b^2", ".nx-math-tooltip");
  await expect(back.locator(".katex")).toBeVisible({ timeout: 15_000 });
});
