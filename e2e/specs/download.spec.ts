import { test, expect } from "../fixtures";
import type { Download, Page } from "@playwright/test";
import { readFileSync } from "node:fs";

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

/** The names inside a ZIP's central directory, read by hand: enough to
 *  say the archive is whole and holds the file, without a library. */
function namesIn(archive: Buffer): string[] {
  const names: string[] = [];
  // End of central directory record, searched from the end.
  const end = archive.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  expect(end).toBeGreaterThan(0);
  const count = archive.readUInt16LE(end + 10);
  let at = archive.readUInt32LE(end + 16);
  for (let index = 0; index < count; index += 1) {
    expect(archive.readUInt32LE(at)).toBe(0x02014b50);
    const nameLength = archive.readUInt16LE(at + 28);
    const extraLength = archive.readUInt16LE(at + 30);
    const commentLength = archive.readUInt16LE(at + 32);
    names.push(archive.subarray(at + 46, at + 46 + nameLength).toString("utf8"));
    at += 46 + nameLength + extraLength + commentLength;
  }
  return names;
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
  await row.getByTestId("row-actions").getByRole("button", { name: "Zip" }).click();
  const download = await waiting;
  expect(namesIn(await zipOf(download))).toContain("main.tex");
});
