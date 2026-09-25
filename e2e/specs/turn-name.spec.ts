import { test, expect } from "../fixtures";
import type { Page } from "@playwright/test";

/** A Claude turn has no name over it.
 *
 *  Every reply used to carry the agent's name in the pen colour above it,
 *  beside the pen rule down its side and under the column's own header
 *  that already says it: in a working exchange of short turns the name
 *  was a third of the column's lines.  The rule alone marks a reply now;
 *  the time the reply was written sits at the end of its first line, in
 *  the layout at rest so nothing moves, and shows under the pointer or
 *  with focus.  A screen reader still hears the name.
 */

async function ask(page: Page, script: string, question: string) {
  const composer = page.locator("textarea");
  await composer.click();
  await composer.fill(`#script:${script}\n${question}`);
  await page.getByRole("button", { name: "Send" }).click();
}

test("a reply carries the pen rule and no name, and its time shows under the pointer", async ({ tab }) => {
  // The welcome turn has no name over it either.
  await expect(tab.getByText(/working inside this project/)).toBeVisible({ timeout: 20_000 });
  await expect(tab.locator(".nx-turn-who")).toHaveCount(0);

  await ask(tab, "working", "Read the theory chapter.");
  const turn = tab.getByTestId("agent-turn").last();
  await expect(turn).toContainText("Read it.", { timeout: 20_000 });
  await expect(tab.locator(".nx-turn-who")).toHaveCount(0);
  // The name is there for a screen reader, and only for one.
  const name = turn.locator(".sr-only");
  await expect(name).toHaveText("Claude");
  expect(await name.evaluate((el) => el.getBoundingClientRect().width)).toBeLessThanOrEqual(1);

  // The time is laid out at rest and invisible; the pointer shows it and
  // the prose does not move when it does.
  const time = turn.getByTestId("turn-time");
  const prose = turn.locator(".t-prose").first();
  await tab.mouse.move(0, 0);
  await expect(time).toHaveCSS("visibility", "hidden");
  await expect(time).toHaveText(/^\d{1,2}:\d{2}/);
  const before = await prose.boundingBox();
  await turn.hover();
  await expect(time).toHaveCSS("visibility", "visible");
  expect(await prose.boundingBox()).toEqual(before);
  await tab.mouse.move(0, 0);
  await expect(time).toHaveCSS("visibility", "hidden");
  // Focus shows it too.
  await turn.focus();
  await expect(time).toHaveCSS("visibility", "visible");

  // The tool line under it: the verb in the interface face, and only the
  // path the machine produced in the code face.
  const faces = await tab.locator(".nx-tool-line").first().evaluate((line) =>
    Array.from(line.querySelectorAll("span")).map((s) => [s.textContent, getComputedStyle(s).fontFamily]),
  );
  expect(faces[0][0]).toBe("Read");
  expect(faces[0][1]).toMatch(/^"Source Sans 3"/);
  expect(faces[1][0]).toBe("chapters/02_theory.tex");
  expect(faces[1][1]).toMatch(/^"Source Code Pro"/);
  expect(await tab.evaluate(() => document.fonts.check('12px "Source Sans 3"'))).toBe(true);
});
