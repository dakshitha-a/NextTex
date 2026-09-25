import { test, expect, openProject } from "../fixtures";
import { writeFileSync } from "node:fs";
import { join } from "node:path";

/** Reading a long document through does not keep every page it drew.
 *
 *  The probe (Q-031) scrolled the preview of a 600-page thesis from the
 *  first page to the last and added up the canvases holding pixels: 147
 *  megapixels at the end, about 590 MB, in a straight line with what had
 *  been read. Pages far from the view give their pixels back now. Here a
 *  120-page document is read through, and what is held at the end is a
 *  few screens' worth, not the whole document's. */

test("reading 120 pages through holds a few screens of pixels, not all of them", async ({
  app, project, page,
}) => {
  test.setTimeout(180_000);
  const pages = Array.from({ length: 120 }, (_, i) => `Page ${i + 1} of the document.\n\\newpage`).join("\n");
  writeFileSync(join(project.root, "main.tex"),
    `\\documentclass{article}\n\\begin{document}\n${pages}\n\\end{document}\n`);
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.goto(`${app.base}/?token=${app.token}`);
  await page.getByText("Projects", { exact: false }).first().waitFor();
  await openProject(page, project.root);
  await expect(page.locator(".nx-page")).toHaveCount(120, { timeout: 60_000 });

  const held = () => page.evaluate(() => {
    let pixels = 0;
    for (const canvas of Array.from(document.querySelectorAll(".nx-page canvas"))) {
      const c = canvas as HTMLCanvasElement;
      pixels += c.width * c.height;
    }
    return pixels / 1e6;
  });
  const scroller = await page.evaluateHandle(() => {
    let el = document.querySelector(".nx-page")?.parentElement ?? null;
    while (el && el.scrollHeight <= el.clientHeight + 10) el = el.parentElement;
    return el;
  });
  const total = await scroller.evaluate((el) => (el as HTMLElement).scrollHeight);
  const step = await scroller.evaluate((el) => (el as HTMLElement).clientHeight);
  const oneScreen = await held();
  let most = 0;
  for (let at = 0; at < total; at += step) {
    await scroller.evaluate((el, y) => { (el as HTMLElement).scrollTop = y; }, at);
    await page.waitForTimeout(120);
    most = Math.max(most, await held());
  }
  await page.waitForTimeout(500);
  const atTheEnd = await held();
  // Seven screens of pages at most: the one in view, the drawing window,
  // and three kept either side. Without the release it is every page.
  expect(atTheEnd).toBeLessThan(Math.max(oneScreen, 1) * 12);
  expect(most).toBeLessThan(Math.max(oneScreen, 1) * 14);
  // And a page scrolled back to is drawn again.
  await scroller.evaluate((el) => { (el as HTMLElement).scrollTop = 0; });
  await expect.poll(async () => page.evaluate(() => {
    const first = document.querySelector(".nx-page canvas") as HTMLCanvasElement | null;
    return first ? first.width : 0;
  }), { timeout: 10_000 }).toBeGreaterThan(0);
});
