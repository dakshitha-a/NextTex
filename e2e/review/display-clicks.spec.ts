import { test, expect, openProject } from "../fixtures";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/** Every glyph of bench/inverse-search/docs/displays.tex, double-clicked.
 *
 *  The census in bench/inverse-search reads words, and its truth cannot
 *  tell one row of a display from another; this clicks each glyph of the
 *  displays in Chromium and prints what the editor then selects, for a
 *  person to read. Not a check: run it with
 *    npx playwright test --config review/review.config.ts display-clicks
 */

const BENCH = join(new URL(".", import.meta.url).pathname, "..", "..", "bench", "inverse-search");
test("every glyph of the displays", async ({ app, project, page }) => {
  test.setTimeout(900_000);
  writeFileSync(join(project.root, "main.tex"), readFileSync(join(BENCH, "docs", "displays.tex")));
  await page.goto(`${app.base}/?token=${app.token}`);
  await page.getByText("Projects", { exact: false }).first().waitFor();
  await openProject(page, project.root);
  await expect(page.locator(".nx-page").first()).toBeAttached({ timeout: 90_000 });
  await page.waitForTimeout(2500);
  const spans = page.locator(".nx-page").first().locator(".nx-text-layer span:not(:has(span))");
  const count = await spans.count();
  const out: string[] = [];
  for (let k = 0; k < count; k += 1) {
    const span = spans.nth(k);
    const text = (await span.textContent()) ?? "";
    if (!text.trim() || /^[\s=+\-−·×<>,()]+$/.test(text) || text.length > 6) continue;
    const box = await span.boundingBox();
    if (!box || box.width < 1) continue;
    await page.mouse.dblclick(box.x + box.width / 2, box.y + box.height / 2);
    await page.waitForTimeout(500);
    const sel = await page.evaluate(() => window.getSelection()?.toString() ?? "");
    const st = (await page.getByText(/Ln \d+, Col \d+/).first().textContent()) ?? "";
    out.push(`${JSON.stringify(text)}\t${JSON.stringify(sel)}\t${st}`);
  }
  console.log("RESULTS\n" + out.join("\n"));
});
