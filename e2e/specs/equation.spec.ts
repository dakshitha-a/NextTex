import { test, expect } from "../fixtures";
import type { Page } from "@playwright/test";

/** An equation as an image, from the formula card.
 *
 *  The card that shows an equation under the pointer has two verbs, Copy
 *  as SVG and Save as PNG, and a line under them that says what happened.
 *  The equation is typeset by the project's own TeX with the document's
 *  preamble, so a macro defined there is set, which KaTeX in the card
 *  could not promise.
 */

const SOURCE = [
  "\\documentclass{article}",
  "\\newcommand{\\tauf}{\\tau_{\\mathrm{fast}}}",
  "\\begin{document}",
  "The decay $S(t) = A e^{-t/\\tauf}$ is fitted.",
  "An unknown $\\nosuchmacro x$ fails.",
  "\\end{document}",
  "",
].join("\n");

/** The middle of one token on the line holding `contains`. */
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

/** Hovered until the card is there, then the pointer moved onto the card
 *  so it stays. */
async function card(tab: Page, contains: string, token: string) {
  await expect.poll(async () => {
    await tab.mouse.move(5, 5);
    await tab.waitForTimeout(150);
    const point = await pointAt(tab, contains, token);
    if (!point) return 0;
    await tab.mouse.move(point.x - 4, point.y);
    await tab.mouse.move(point.x, point.y);
    await tab.mouse.move(point.x + 1, point.y);
    await tab.waitForTimeout(600);
    return tab.locator(".nx-math-tooltip").count();
  }, { timeout: 30_000, intervals: [500] }).toBeGreaterThan(0);
  const found = tab.locator(".nx-math-tooltip").first();
  await found.hover();
  return found;
}

test("the formula card copies an SVG and saves a PNG set with the preamble", async ({ app, project, tab }) => {
  await expect(tab.locator(".cm-editor")).toBeVisible({ timeout: 45_000 });
  await fetch(`${app.base}/api/projects/${project.id}/file`, {
    method: "PUT",
    headers: { "content-type": "application/json", "x-nexttex-token": app.token },
    body: JSON.stringify({ path: "main.tex", text: SOURCE, compile: false }),
  });
  await expect(tab.locator(".cm-line", { hasText: "The decay" })).toBeVisible({ timeout: 15_000 });
  await tab.context().grantPermissions(["clipboard-read", "clipboard-write"]);

  const formula = await card(tab, "The decay", "S(t)");
  await formula.getByTestId("equation-svg").click();
  await expect(formula.getByTestId("equation-said")).toHaveText(/^Copied\. An SVG/, { timeout: 30_000 });
  const copied = await tab.evaluate(() => navigator.clipboard.readText());
  expect(copied).toContain("<svg");

  const saving = tab.waitForEvent("download");
  await formula.getByTestId("equation-png").click();
  const saved = await saving;
  expect(saved.suggestedFilename()).toBe("equation.png");
  await expect(formula.getByTestId("equation-said")).toHaveText(/^Saved as equation\.png/);

  // What TeX said is what the card says.
  await tab.mouse.move(5, 5);
  await expect(tab.locator(".nx-math-tooltip")).toHaveCount(0, { timeout: 10_000 });
  const broken = await card(tab, "An unknown", "nosuchmacro");
  await broken.getByTestId("equation-svg").click();
  await expect(broken.getByTestId("equation-said")).toContainText("Undefined control sequence", {
    timeout: 30_000,
  });
});
