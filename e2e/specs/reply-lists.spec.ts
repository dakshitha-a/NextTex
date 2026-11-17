import { writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Locator, Page } from "@playwright/test";
import { test, expect, openProject } from "../fixtures";

/** A numbered list with an explanation under each item counts 1, 2, 3.
 *
 *  A model writes an item's title on the numbered line and its
 *  explanation three spaces in on the line below.  The parser stopped
 *  the list at the indented line and made it a paragraph, so every item
 *  opened a list of its own: each read "1.", and each explanation stood
 *  flush left outside the list.  Now the indented lines belong to their
 *  item, and a list an unindented paragraph does split goes on counting
 *  from its first number.  The Markdown preview reads Markdown with the
 *  same code, so it is held here too, with a double-click on an
 *  explanation landing on the explanation's own line.
 */

/** Where a word is drawn inside an element: the box of its first
 *  occurrence in the element's text. */
async function wordBox(within: Locator, word: string) {
  return within.evaluate((el, word) => {
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const at = node.textContent!.indexOf(word);
      if (at < 0) continue;
      const range = document.createRange();
      range.setStart(node, at);
      range.setEnd(node, at + word.length);
      const box = range.getBoundingClientRect();
      return { x: box.x, y: box.y, width: box.width, height: box.height };
    }
    throw new Error(`no ${word}`);
  }, word);
}

async function ask(page: Page, script: string, question: string) {
  const composer = page.locator("textarea");
  await composer.click();
  await composer.fill(`#script:${script}\n${question}`);
  await page.getByRole("button", { name: "Send" }).click();
}

test("a reply's numbered items keep their explanations and their numbers", async ({ tab }) => {
  await ask(tab, "numbered", "Suggest a title for the thesis.");
  const chat = tab.getByTestId("chat");
  await expect(chat.getByText("A fourth, if you want one")).toBeVisible({ timeout: 20_000 });

  const lists = chat.locator("ol");
  await expect(lists).toHaveCount(2);
  const items = lists.first().locator(":scope > li");
  await expect(items).toHaveCount(3);
  await expect(items.nth(1)).toContainText("The most memorable of the three.");
  await expect(lists.first()).not.toHaveAttribute("start");
  await expect(lists.nth(1)).toHaveAttribute("start", "4");

  // The explanation is drawn under its title, inside the item, not as a
  // paragraph of its own at the column's edge.
  await expect(chat.locator("p", { hasText: "The most memorable" })).toHaveCount(0);
  const titleBox = await wordBox(items.nth(1), "Beyond");
  const lineBox = await wordBox(items.nth(1), "The most");
  const listBox = (await lists.first().boundingBox())!;
  expect(titleBox.x).toBeGreaterThan(listBox.x + 8);
  expect(Math.abs(lineBox.x - titleBox.x)).toBeLessThan(2);
  expect(lineBox.y).toBeGreaterThan(titleBox.y);

  // The browser draws the numbers from the list and its start.
  const markers = await lists.evaluateAll((all) =>
    all.flatMap((ol) => {
      const start = (ol as HTMLOListElement).start;
      return [...ol.children].map((_, at) => start + at);
    }),
  );
  expect(markers).toEqual([1, 2, 3, 4]);
});

test("the Markdown preview's numbered items do the same, and a double-click finds the explanation", async ({
  app, project, page,
}) => {
  writeFileSync(
    join(project.root, "titles.md"),
    [
      "# Titles",                                // 1
      "",                                        // 2
      "1. **Theory and Experiment**",            // 3
      "   The subtitle maps onto three questions.", // 4
      "2. **Beyond the Simulation Window**",     // 5
      "   The most memorable of them.",          // 6
      "",
    ].join("\n"),
  );
  await page.goto(`${app.base}/?token=${app.token}`);
  await page.getByText("Projects", { exact: false }).first().waitFor();
  await openProject(page, project.root);
  await expect(page.locator(".cm-editor")).toBeVisible({ timeout: 30_000 });
  await page.locator('[role="tree"] [data-path="titles.md"]').click();
  const view = page.getByTestId("markdown-view");
  await expect(view.locator("ol > li")).toHaveCount(2, { timeout: 15_000 });
  await expect(view.locator("ol")).toHaveCount(1);
  await expect(view.locator("ol > li").nth(1)).toContainText("The most memorable of them.");

  const caret = () => page.getByText(/^Ln \d+, Col \d+$/).innerText();
  const word = await wordBox(view.locator("ol > li").nth(1), "memorable");
  await page.mouse.dblclick(word.x + word.width / 2, word.y + word.height / 2);
  await expect.poll(caret).toMatch(/^Ln 6, Col \d+$/);
  expect(await page.evaluate(() => String(window.getSelection()))).toBe("memorable");
  await view.locator("ol > li").nth(1).locator("strong").dblclick();
  await expect.poll(caret).toMatch(/^Ln 5, Col \d+$/);
});
