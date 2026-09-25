import { test } from "@playwright/test";
import { startServer } from "../server";
import { openProject } from "../fixtures";
import { cpSync, rmSync } from "node:fs";
import { join } from "node:path";

/** Q-031: what the preview holds after a long document is read through.
 *
 *  The probe of September 2026 read that the preview draws the pages near
 *  the view and never frees one it drew.  This builds the bench's thesis,
 *  scrolls the preview from the first page to the last in steps, and after
 *  each step counts the page canvases that hold a backing store and adds
 *  up their pixels.  A preview that frees what it no longer shows holds a
 *  roughly constant number; one that does not climbs with the page count.
 *
 *  Needs `NEXTTEX_THESIS` pointing at a project `bench.build_project` made,
 *  and a TeX on PATH.  The full build takes about a minute. */

const THESIS = process.env.NEXTTEX_THESIS ?? "";

test("the page canvases held after reading a thesis through", async ({ page }) => {
  test.skip(!THESIS, "set NEXTTEX_THESIS to a bench project directory");
  test.setTimeout(600_000);
  const app = await startServer();
  const root = join(app.projects, "thesis");
  cpSync(THESIS, root, { recursive: true });
  rmSync(join(root, ".git"), { recursive: true, force: true });
  await fetch(`${app.base}/api/projects`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-nexttex-token": app.token },
    body: JSON.stringify({ path: root }),
  });

  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.goto(`${app.base}/?token=${app.token}`);
  await page.getByText("Projects", { exact: false }).first().waitFor();
  await openProject(page, root);
  await page.locator(".nx-page").nth(5).waitFor({ timeout: 300_000 });

  const held = () => page.evaluate(() => {
    let count = 0;
    let pixels = 0;
    for (const canvas of Array.from(document.querySelectorAll(".nx-page canvas"))) {
      const c = canvas as HTMLCanvasElement;
      if (c.width > 0 && c.height > 0) {
        count += 1;
        pixels += c.width * c.height;
      }
    }
    return { pages: document.querySelectorAll(".nx-page").length, count, megapixels: pixels / 1e6 };
  });

  const scroller = await page.evaluateHandle(() => {
    let el = document.querySelector(".nx-page")?.parentElement ?? null;
    while (el && el.scrollHeight <= el.clientHeight + 10) el = el.parentElement;
    return el;
  });

  console.log("AT THE TOP:", JSON.stringify(await held()));
  const total = await scroller.evaluate((el) => (el as HTMLElement).scrollHeight);
  const step = await scroller.evaluate((el) => (el as HTMLElement).clientHeight);
  let at = 0;
  let checkpoint = 0;
  while (at < total) {
    at += step;
    await scroller.evaluate((el, y) => { (el as HTMLElement).scrollTop = y; }, at);
    await page.waitForTimeout(120);
    if (at >= checkpoint) {
      console.log(`AT ${Math.round((100 * at) / total)}%:`, JSON.stringify(await held()));
      checkpoint += total / 4;
    }
  }
  await page.waitForTimeout(1500);
  const end = await held();
  // A canvas's backing store is four bytes a pixel, whether or not the
  // page is anywhere near the view.
  console.log("AT THE END:", JSON.stringify(end),
    `about ${Math.round(end.megapixels * 4)} MB of canvas`);
  await app.stop();
});
