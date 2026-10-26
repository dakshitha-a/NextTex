import type { Page } from "@playwright/test";
import { test, expect } from "../fixtures";

/** Maths in a reply is set, not shown as its source.
 *
 *  The thesis's agent explained the time-derivative coupling and the
 *  column showed `$\dot{\mathbf{R}}$` as typed, with every `_` between
 *  two dollars taken for italics, so the subscripts vanished and the rest
 *  of the paragraph leaned.  The reply here is that answer: inline maths,
 *  a display on its own line, and a sentence with two prices that must
 *  stay prose.
 */

async function ask(page: Page, script: string, question: string) {
  const composer = page.locator("textarea");
  await composer.click();
  await composer.fill(`#script:${script}\n${question}`);
  await page.getByRole("button", { name: "Send" }).click();
}

test("maths in a reply is set by KaTeX, inline and displayed, and prices stay prose", async ({ tab }) => {
  await ask(tab, "maths", "What is the nuclear velocity in Eq. 2.11?");
  const chat = tab.getByTestId("chat");
  await expect(chat.getByText(/which I left as prose/)).toBeVisible({ timeout: 20_000 });

  await expect(chat.locator('[data-maths="inline"] .katex')).toHaveCount(6);
  await expect(chat.locator('[data-maths="display"] .katex-display')).toHaveCount(1);
  await expect(chat.locator('[data-maths="source"]')).toHaveCount(0);
  // No dollar or backslash command is left in the text, and no italics
  // were made out of the subscripts.
  const prose = await chat.locator(".t-prose").last().innerText();
  expect(prose).not.toMatch(/\\mathbf|\$\\/);
  expect(prose).toContain("between $5 and $10");
  await expect(chat.locator("em")).toHaveCount(0);

  // KaTeX's fonts arrived, so this is the maths and not a fallback face.
  expect(await tab.evaluate(() => document.fonts.check("16px KaTeX_Main"))).toBe(true);

  // The maths takes the column's ink in either theme, and a display wider
  // than the column would scroll in its own box.
  const ink = await chat.locator(".t-prose").last().evaluate((el) => getComputedStyle(el).color);
  const katexInk = await chat.locator('[data-maths="inline"] .katex').first().evaluate((el) => getComputedStyle(el).color);
  expect(katexInk).toBe(ink);
  const display = chat.locator('[data-maths="display"]');
  expect(await display.evaluate((el) => getComputedStyle(el).overflowX)).toBe("auto");
});
