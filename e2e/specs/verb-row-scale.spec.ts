import { test, expect, openProject } from "../fixtures";
import type { Page } from "@playwright/test";

/** The verb row keeps clear of the selection at every interface size.
 *
 *  The row was placed from viewport measurements and drawn in shell
 *  pixels, which the interface size setting scales with `zoom`, so at any
 *  size but 100 % it landed that much further down and right: over the
 *  selected paragraph at 110 %, below it and off the pane at 125 %.  The
 *  writer met it as a menu with "no order to where it appears".  The
 *  placement is in one space now, and this checks the same two
 *  selections at 100 % and 125 %: the row lies inside the editor pane and
 *  touches no line of the selection.
 */

type Rect = { x: number; y: number; w: number; h: number };

async function lineRect(page: Page, contains: string): Promise<Rect> {
  return page.evaluate((contains) => {
    const line = [...document.querySelectorAll(".cm-line")].find((el) => el.textContent?.includes(contains))!;
    const b = line.getBoundingClientRect();
    return { x: b.x, y: b.y, w: b.width, h: b.height };
  }, contains);
}

async function rowRect(page: Page): Promise<Rect> {
  const row = page.getByTestId("selection-reword").locator("..");
  await expect(row).toBeVisible();
  const b = (await row.boundingBox())!;
  return { x: b.x, y: b.y, w: b.width, h: b.height };
}

function overlaps(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

function inside(a: Rect, b: Rect): boolean {
  return a.x >= b.x - 0.5 && a.y >= b.y - 0.5 && a.x + a.w <= b.x + b.w + 0.5 && a.y + a.h <= b.y + b.h + 0.5;
}

const WORDS = "Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. ";

for (const scale of [100, 125]) {
  test(`the row is clear of the selection and inside the pane at ${scale} %`, async ({
    app, project, page,
  }) => {
    // The size has to be in place before the app draws, the way a writer's
    // remembered choice is, so the tab fixture is not used.
    await page.addInitScript((s) => localStorage.setItem("nexttex.ui.scale", String(s)), scale);
    await page.goto(`${app.base}/?token=${app.token}`);
    await page.getByText("Projects", { exact: false }).first().waitFor();
    await openProject(page, project.root);
    await page.locator(".cm-content").click();
    await page.keyboard.press("Control+End");
    await page.keyboard.type("\nPARA-A " + WORDS.repeat(3) + "\n\nPARA-B " + WORDS.repeat(3) + "\n\nPARA-C " + WORDS.repeat(2));
    await page.waitForTimeout(300);
    const pane = (await page.getByTestId("editor-pane").boundingBox())!;
    const paneRect = { x: pane.x, y: pane.y, w: pane.width, h: pane.height };

    const select = async (tag: string) => {
      // From the paragraph's first word to its last row, with the mouse.
      const line = await lineRect(page, tag);
      await page.mouse.move(line.x + 12, line.y + 10);
      await page.mouse.down();
      await page.mouse.move(line.x + line.w - 30, line.y + line.h - 6, { steps: 10 });
      await page.mouse.up();
      await page.waitForTimeout(400);
      const row = await rowRect(page);
      const selected = await lineRect(page, tag);
      expect(inside(row, paneRect), `${tag}: row ${JSON.stringify(row)} inside pane ${JSON.stringify(paneRect)}`).toBe(true);
      expect(overlaps(row, selected), `${tag}: row ${JSON.stringify(row)} clear of ${JSON.stringify(selected)}`).toBe(false);
    };

    // The last paragraph, with the view at the end of the file: the row
    // goes above it.
    await select("PARA-C");
    // The first, scrolled to the top of the view: the row goes below it.
    await page.evaluate(() => {
      const line = [...document.querySelectorAll(".cm-line")].find((el) => el.textContent?.includes("PARA-A"))!;
      line.scrollIntoView({ block: "start" });
    });
    await page.waitForTimeout(300);
    await select("PARA-A");
  });
}
