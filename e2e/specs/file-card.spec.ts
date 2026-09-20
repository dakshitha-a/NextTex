import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test, expect, openFolders } from "../fixtures";
import { png } from "../png";

/** The card beside a tree row for a file the editor cannot edit.
 *
 *  Resting the pointer on an image, a PDF used as a figure or any other
 *  binary for 400 ms opens a card with a thumbnail, the file's name and
 *  one line with its size in pixels, its size in bytes and its folder. A
 *  raster is the file itself; a PDF is its first page, drawn by the pdf.js
 *  the preview loads; a file with no picture is the name and the size. A
 *  text file opens nothing, since the editor is where it is looked at.
 */

/** One page, 300 by 200 points, with no cross-reference table: pdf.js
 *  rebuilds one, which is what it does for most PDFs a figure script
 *  writes anyway. */
const PDF = [
  "%PDF-1.4",
  "1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj",
  "2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj",
  "3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] >> endobj",
  "trailer << /Root 1 0 R >>",
  "%%EOF",
].join("\n");

test.beforeEach(({ project }) => {
  mkdirSync(join(project.root, "figures"), { recursive: true });
  writeFileSync(join(project.root, "figures", "small.png"), png(120, 80));
  writeFileSync(join(project.root, "figures", "plot.pdf"), PDF);
  writeFileSync(join(project.root, "figures", "old.eps"), "%!PS-Adobe-3.0 EPSF-3.0\n");
});

test("an image row shows its picture and its facts; a text row shows nothing", async ({ tab }) => {
  await openFolders(tab, "figures/small.png");
  const row = tab.locator('[role="tree"] [data-path="figures/small.png"]');
  await row.hover();
  const card = tab.getByTestId("file-card");
  await expect(card).toBeVisible({ timeout: 5_000 });
  await expect(card).toContainText("small.png");
  // The picture's own size, the bytes, and where it is.
  await expect(card).toContainText("120 × 80");
  await expect(card).toContainText("in figures");
  await expect(card.locator("img")).toBeVisible();
  // Beside the row, under it, and inside the window.
  const box = (await card.boundingBox())!;
  const rowBox = (await row.boundingBox())!;
  expect(box.y).toBeGreaterThanOrEqual(rowBox.y + rowBox.height - 1);
  expect(box.x).toBeGreaterThan(rowBox.x);

  // Leaving the row closes it; a text row opens none however long the
  // pointer rests.
  await tab.locator('[role="tree"] [data-path="main.tex"]').hover();
  await expect(card).toHaveCount(0);
  await tab.waitForTimeout(700);
  await expect(card).toHaveCount(0);
});

test("a PDF shows its first page, and a file with no picture its name and size", async ({ tab }) => {
  await openFolders(tab, "figures/plot.pdf");
  await tab.locator('[role="tree"] [data-path="figures/plot.pdf"]').hover();
  const card = tab.getByTestId("file-card");
  await expect(card).toBeVisible({ timeout: 5_000 });
  await expect(card).toContainText("plot.pdf");
  // Drawn by pdf.js, so it arrives after the card does.
  await expect(card.locator("img")).toBeVisible({ timeout: 15_000 });
  await expect(card).toContainText("300 × 200 pt");

  await tab.locator('[role="tree"] [data-path="figures/old.eps"]').hover();
  await expect(card).toContainText("old.eps", { timeout: 5_000 });
  await expect(card).toContainText("in figures");
  await expect(card.locator("img")).toHaveCount(0);
});

test("the keyboard reaches the card too, and a key press dismisses it", async ({ tab }) => {
  await openFolders(tab, "figures/small.png");
  const row = tab.locator('[role="tree"] [data-path="figures/small.png"]');
  await row.focus();
  const card = tab.getByTestId("file-card");
  await expect(card).toBeVisible({ timeout: 5_000 });
  await tab.keyboard.press("ArrowDown");
  await expect(card).toHaveCount(0);
});
