import { test, expect, openProject } from "../fixtures";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Page } from "@playwright/test";

/** The text over the typeset page: a drag that crosses the gap under a
 *  paragraph, and what a copy carries.
 *
 *  Each is a fault an audit of the layer found: the selection dropped from
 *  561 characters to 15 when a drag reached the gap below a paragraph; and
 *  a copy carried "Schr¨odinger" and "misrep-" with a line break, as the
 *  PDF holds them.
 */

const MAIN = String.raw`\documentclass{article}
\begin{document}
The first paragraph runs over a few lines so that a drag can start in it and go down into the gap under it, which is where the selection used to jump back to almost nothing at all.

Schr\"odinger wrote it, the caf\'e was open, and na\"ive readers agreed.

\parbox{5cm}{Some exceedingly long words: internationalization, misrepresentations, characteristically, uncharacteristically, institutionalization.}

The last paragraph sits below the gap.
\end{document}
`;

async function open(app: { base: string; token: string }, project: { root: string }, page: Page) {
  writeFileSync(join(project.root, "main.tex"), MAIN);
  await page.goto(`${app.base}/?token=${app.token}`);
  await page.getByText("Projects", { exact: false }).first().waitFor();
  await openProject(page, project.root);
  await expect(page.locator(".nx-text-layer span", { hasText: "The last paragraph" }).first())
    .toBeAttached({ timeout: 60_000 });
}

const selectedLength = (page: Page) => page.evaluate(() => String(window.getSelection()).length);

test("a drag down past the end of a paragraph keeps what it selected", async ({ app, project, page }) => {
  await open(app, project, page);
  const start = await page.locator(".nx-text-layer span", { hasText: "The first paragraph" }).first().boundingBox();
  const last = await page.locator(".nx-text-layer span", { hasText: "The last paragraph" }).first().boundingBox();
  await page.mouse.move(start!.x + 2, start!.y + start!.height / 2);
  await page.mouse.down();
  // Down the paragraph, then into the gaps under it, step by step: the
  // selection may grow, and must never fall back.
  let most = 0;
  const steps = 12;
  for (let i = 1; i <= steps; i += 1) {
    const y = start!.y + ((last!.y - start!.y) * i) / steps;
    await page.mouse.move(start!.x + 180, y, { steps: 3 });
    const now = await selectedLength(page);
    expect(now, `at step ${i}`).toBeGreaterThanOrEqual(most);
    most = now;
  }
  await page.mouse.up();
  expect(most).toBeGreaterThan(150);
});

test("a copy from the page carries its words as the page reads them", async ({ app, project, page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await open(app, project, page);
  /** Copy from `from` to the end of `to`, or, when `to` is null, to the
   *  end of the span before the one holding `before`. */
  const copy = async (from: string, to: string | null, before = "") => {
    await page.evaluate(({ from, to, before }) => {
      const spans = [...document.querySelectorAll(".nx-text-layer span")].filter((s) => s.firstChild);
      const a = spans.find((s) => (s.textContent ?? "").includes(from))!;
      const b = to
        ? spans.find((s) => (s.textContent ?? "").includes(to))!
        : spans[spans.findIndex((s) => (s.textContent ?? "").includes(before)) - 1];
      const range = document.createRange();
      range.setStart(a.firstChild!, (a.textContent ?? "").indexOf(from));
      range.setEnd(b.firstChild!, to ? (b.textContent ?? "").indexOf(to) + to.length : (b.textContent ?? "").length);
      const selection = window.getSelection()!;
      selection.removeAllRanges();
      selection.addRange(range);
    }, { from, to, before });
    await page.keyboard.press("Control+c");
    return page.evaluate(() => navigator.clipboard.readText());
  };
  // The accents are glyphs of their own in the PDF, before their letters.
  const accents = await copy("Schr", "readers agreed");
  expect(accents).toContain("Schrödinger");
  expect(accents).toContain("café");
  expect(accents).toContain("naïve");
  // The narrow box makes TeX hyphenate; the copy has no hyphen-and-break.
  const words = await copy("Some", null, "The last paragraph");
  expect(words).not.toMatch(/\p{L}-\n\p{Ll}/u);
  expect(words).toContain("misrepresentations");
});
