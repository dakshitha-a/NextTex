import { test, expect } from "../fixtures";
import type { Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { landed } from "../typing";

/** Restoring a version of the file that is open puts it in the editor.
 *
 *  Found while filming the README's history GIF: a paragraph deleted, the
 *  opening version chosen in History and restored, and the file on disk
 *  and the typeset page both had the paragraph back while the editor went
 *  on showing it gone. The next keystroke would have written the deletion
 *  back over the restore. */

const PARAGRAPH = "this~\\cite{knuth1984}, and";

/** The file itself, read from disk rather than through the server. */
const onDisk = (root: string) => readFileSync(join(root, "main.tex"), "utf8");

async function openHistory(page: Page) {
  const drawer = page.getByTestId("drawer");
  await expect
    .poll(async () => {
      const showing =
        (await drawer.count()) > 0 && (await drawer.getAttribute("data-drawer")) === "history";
      if (!showing) await page.getByTestId("bar-history").click();
      return showing;
    }, { timeout: 15_000, intervals: [400] })
    .toBe(true);
  await expect(page.getByTestId("version").first()).toBeVisible({ timeout: 10_000 });
}

test("a restored version reaches the open editor, and stays after the next keystroke", async ({
  tab, app, project,
}) => {
  await expect(tab.locator(".cm-content")).toContainText(PARAGRAPH, { timeout: 20_000 });

  // The paragraph, selected from its first line to its last and deleted.
  const first = tab.locator(".cm-line").filter({ hasText: "Start here." }).first();
  const last = tab.locator(".cm-line").filter({ hasText: "Section~\\ref{sec:results}" }).first();
  await first.click({ position: { x: 3, y: 5 } });
  await tab.keyboard.press("Home");
  await tab.keyboard.down("Shift");
  await last.click();
  await tab.keyboard.press("End");
  await tab.keyboard.up("Shift");
  await tab.keyboard.press("Backspace");
  await expect.poll(() => onDisk(project.root).includes(PARAGRAPH), {
    timeout: 15_000,
  }).toBe(false);

  // The opening version, restored from the viewing toolbar.
  await openHistory(tab);
  await expect.poll(async () => tab.getByTestId("version").count(), { timeout: 15_000 }).toBeGreaterThan(1);
  await tab.getByTestId("version").last().click();
  await expect(tab.getByTestId("viewing-banner")).toBeVisible();
  await tab.getByRole("button", { name: "Restore this" }).click();
  await tab.getByRole("button", { name: "Restore", exact: true }).click();
  await expect(tab.getByTestId("viewing-banner")).toHaveCount(0, { timeout: 10_000 });

  await expect.poll(() => onDisk(project.root).includes(PARAGRAPH), {
    timeout: 15_000,
  }).toBe(true);
  await expect(tab.locator(".cm-content")).toContainText(PARAGRAPH, { timeout: 10_000 });

  // And the next keystroke keeps it.
  await tab.locator(".cm-content").click();
  await tab.keyboard.press("Control+End");
  await tab.keyboard.type("\n% after the restore");
  await landed(app, project, "% after the restore");
  expect(onDisk(project.root)).toContain(PARAGRAPH);
});
