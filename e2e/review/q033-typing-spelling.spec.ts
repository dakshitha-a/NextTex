import { test, expect } from "@playwright/test";
import { startServer } from "../server";
import { openProject, openFolders } from "../fixtures";
import { cpSync } from "node:fs";
import { join } from "node:path";

/** Q-033: the same measurement as `a12-typing.spec.ts`, with spelling on.
 *
 *  The probe of September 2026 found that spelling is off by default now,
 *  and that the original driver never turned it on, so its number never
 *  included the checker's rescan on every keystroke.  This one switches
 *  spelling on through the settings sheet first and waits for the word
 *  list, then measures exactly as the original does.
 *
 *  What follows is the original's own account. */
/** Keystroke latency in the editor, on a thesis rather than on a fixture.
 *
 *  The benchmark measures the server.  Nothing measures the one number a
 *  writer actually feels: the gap between pressing a key and the character
 *  reaching the screen, with spelling and syntax colouring both on, in a
 *  chapter long enough for the decorations to cost something.
 *
 *  Measured inside the page, from `keydown` to the first mutation of the
 *  editor's own DOM, so the number is the app's work and not two frames of
 *  the harness waiting for `requestAnimationFrame`. */

const THESIS = process.env.NEXTTEX_THESIS ?? "";

test("a keystroke, in a seventy kilobyte chapter, with spelling on", async ({ page }) => {
  test.skip(!THESIS, "set NEXTTEX_THESIS to a bench project directory");
  const app = await startServer();
  const root = join(app.projects, "thesis");
  cpSync(THESIS, root, { recursive: true });
  await fetch(`${app.base}/api/projects`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-nexttex-token": app.token },
    body: JSON.stringify({ path: root }),
  });

  await page.goto(`${app.base}/?token=${app.token}`);
  await page.getByText("Projects", { exact: false }).first().waitFor();
  await openProject(page, root);
  await page.locator(".cm-editor").waitFor({ timeout: 60_000 });

  await openFolders(page, "chapters/39.tex");
  await page.getByText("39.tex", { exact: true }).first().click();
  await expect
    .poll(async () =>
      page.evaluate(() =>
        document.querySelector(".cm-content")?.textContent?.length ?? 0,
      ), { timeout: 30_000 })
    .toBeGreaterThan(2000);

  const characters = await page.evaluate(
    () => document.querySelector(".cm-content")?.textContent?.length ?? 0);
  console.log("CHAPTER ON SCREEN, characters rendered:", characters);

  await page.getByTestId("appearance").first().click();
  await page.getByTestId("settings-group-write").click();
  await page.getByTestId("spelling-on").click();
  await page.keyboard.press("Escape");
  const marks = await page.locator(".nx-misspelled").first()
    .waitFor({ timeout: 20_000 }).then(() => "marks drawn", () => "no marks");
  console.log("SPELLING:", marks);
  await page.locator(".cm-content").first().click();
  // At the end of the chapter, in prose, where the checker reads: the
  // original clicks the top, which is inside `\section`, a command.
  await page.keyboard.press("Control+End");
  await page.keyboard.press("Enter");
  await page.keyboard.type("The results wiht ");
  const marked = await page.locator(".nx-misspelled").first()
    .waitFor({ timeout: 20_000 }).then(() => "checker running", () => "checker NOT running");
  console.log("BEFORE MEASURING:", marked);
  await page.waitForTimeout(3000);

  await page.evaluate(() => {
    const w = window as unknown as { _lat: number[]; _down: number };
    w._lat = [];
    w._down = 0;
    document.addEventListener("keydown", () => { w._down = performance.now(); }, true);
    const target = document.querySelector(".cm-content");
    if (!target) return;
    new MutationObserver(() => {
      if (w._down) { w._lat.push(performance.now() - w._down); w._down = 0; }
    }).observe(target, { childList: true, characterData: true, subtree: true });
  });

  for (let i = 0; i < 40; i += 1) {
    await page.keyboard.type("q");
    await page.waitForTimeout(70);
  }

  const took: number[] = await page.evaluate(
    () => (window as unknown as { _lat: number[] })._lat);
  const warm = took.slice(5).sort((a, b) => a - b);
  const at = (p: number) => warm[Math.min(warm.length - 1, Math.floor(warm.length * p))];
  console.log(
    `KEYSTROKE TO DOM ms  n=${warm.length}  median ${at(0.5).toFixed(1)}` +
    `  p90 ${at(0.9).toFixed(1)}  worst ${warm[warm.length - 1].toFixed(1)}`,
  );
  await page.waitForTimeout(1500);
  console.log("MARKS AFTER TYPING:", await page.locator(".nx-misspelled").count());
  expect(warm.length).toBeGreaterThan(20);
  await app.stop();
});
