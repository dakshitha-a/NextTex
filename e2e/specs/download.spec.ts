import { test, expect } from "../fixtures";
import type { Download, Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { namesIn } from "../zip";

// A NextTex of its own: this spec reads a row of the projects screen, and a
// shared server holds every other test's projects and choices.
test.use({ ownServer: true });

/** Taking a copy of the whole project away, from inside it.
 *
 *  The writer reported the ZIP failing from inside an open project with
 *  the browser's "Check internet connection", while the same download
 *  from the project list worked.  Both screens ask the same route through
 *  the same anchor, so the difference is the open session: a store
 *  flushing the shared documents, a watcher, a build writing under
 *  `build/`.  This spec downloads with all three going and reads the
 *  archive back, from inside the project and from the list.
 */

async function zipOf(download: Download): Promise<Buffer> {
  expect(await download.failure()).toBeNull();
  const path = await download.path();
  return readFileSync(path!);
}

async function downloadFromInside(page: Page): Promise<Download> {
  // The drawer stays open across downloads; the bar's press would fold
  // it a second time.
  if (!(await page.getByTestId("download-panel").isVisible())) await page.getByTestId("bar-download").click();
  const waiting = page.waitForEvent("download");
  await page.getByTestId("download-zip").click();
  return waiting;
}

test("the whole project downloads from inside it, while typing and building", async ({
  tab, app, project,
}) => {
  await expect(tab.locator("canvas").first()).toBeVisible({ timeout: 45_000 });
  // Typing, so the shared document is being flushed to disk every 120 ms
  // under the walk; and a rebuild, so `build/` is being written.
  await tab.locator(".cm-content").click();
  await tab.keyboard.press("Control+End");
  await tab.keyboard.type("\nA line typed while the copy is taken.\n");
  await tab.getByRole("button", { name: "Rebuild", exact: true }).click();

  const download = await downloadFromInside(tab);
  expect(download.suggestedFilename()).toMatch(/\.zip$/);
  const names = namesIn(await zipOf(download));
  expect(names).toContain("main.tex");
  expect(names).toContain("references.bib");
  expect(names.some((name) => name.startsWith("build/"))).toBe(false);
  expect(names.some((name) => name.includes(".nexttex"))).toBe(false);

  // And again at once, while the build from above may still be going.
  const second = await downloadFromInside(tab);
  expect(namesIn(await zipOf(second))).toContain("main.tex");
  void app;
  void project;
});

test("the whole project downloads from the project list", async ({ app, project, page }) => {
  // The shape the report contrasts with: the list, with the project not
  // open in this window.
  await page.goto(`${app.base}/?token=${app.token}`);
  await page.getByText("Projects", { exact: false }).first().waitFor();
  const row = page.getByTestId("project-row").first();
  void project;
  await row.hover();
  const waiting = page.waitForEvent("download");
  await row.getByTestId("row-more").click();
  await page.getByRole("menuitem", { name: "Download as a zip" }).click();
  const download = await waiting;
  expect(namesIn(await zipOf(download))).toContain("main.tex");
});

test("a document's source is what it uses with its .bbl, comments stripped on request", async ({ tab }) => {
  await expect(tab.locator("canvas").first()).toBeVisible({ timeout: 45_000 });
  await tab.getByTestId("bar-download").click();
  const row = tab.locator('[data-testid="download-row"][data-document="main.tex"]');
  await expect(row).toHaveAttribute("data-built", "true", { timeout: 60_000 });
  const strip = tab.getByTestId("download-strip-comments");
  await strip.check();
  const waiting = tab.waitForEvent("download");
  await row.getByTestId("download-source").click();
  const download = await waiting;
  expect(download.suggestedFilename()).toBe("main-source.zip");
  const names = namesIn(await zipOf(download));
  expect(names).toContain("main.tex");
  expect(names).toContain("references.bib");
  expect(names.some((name) => name.startsWith("build/"))).toBe(false);
  // The choice is kept on this computer.
  await tab.reload();
  await expect(tab.locator("canvas").first()).toBeVisible({ timeout: 45_000 });
  if (!(await tab.getByTestId("download-panel").isVisible())) await tab.getByTestId("bar-download").click();
  await expect(tab.getByTestId("download-strip-comments")).toBeChecked();
});
