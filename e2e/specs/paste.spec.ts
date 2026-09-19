import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { test, expect } from "../fixtures";

/** Paste data as a table, paste an image as a figure.
 *
 *  A `paste` event carrying tab-separated text is dispatched on the
 *  editor's content element, which is what the browser does with the
 *  clipboard, and a booktabs table arrives at the caret with the caret in
 *  its caption; one undo removes it.  A `paste` carrying a PNG file saves
 *  it under `figures/` through the upload route and writes the figure
 *  environment for it.  The same text inside a `verbatim` block arrives
 *  as it was.
 */

const TSV = "State\tEnergy (eV)\tShare\nFirst\t3.41\t50%\nSecond\t4.07\tR&D";

async function pasteText(tab: import("@playwright/test").Page, text: string) {
  await tab.locator(".cm-content").evaluate((content, body) => {
    const data = new DataTransfer();
    data.setData("text/plain", body);
    content.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }));
  }, text);
}

test("tab-separated text becomes a booktabs table, and one undo removes it", async ({ tab }) => {
  await expect(tab.locator(".cm-editor")).toBeVisible({ timeout: 45_000 });
  const editor = tab.locator(".cm-content");
  await editor.click();
  await tab.keyboard.press("Control+End");
  await tab.keyboard.press("Enter");
  await tab.waitForTimeout(700);
  await pasteText(tab, TSV);
  await expect(editor).toContainText("State & Energy (eV) & Share \\\\");
  await expect(editor).toContainText("Second & 4.07 & R\\&D \\\\");
  await expect(editor).toContainText("\\begin{tabular}{lrl}");
  // The caret is in the caption: typing lands there.
  await tab.keyboard.type("Energies");
  await expect(editor).toContainText("\\caption{Energies}");
  // Two undos: the typed word, then the whole table.
  await tab.keyboard.press("Control+z");
  await tab.keyboard.press("Control+z");
  await expect(editor).not.toContainText("Energy (eV) & Share");
});

test("inside verbatim the text arrives as it was", async ({ tab }) => {
  await expect(tab.locator(".cm-editor")).toBeVisible({ timeout: 45_000 });
  const editor = tab.locator(".cm-content");
  await editor.click();
  await tab.keyboard.press("Control+End");
  await tab.keyboard.type("\n\\begin{verbatim}\n");
  await pasteText(tab, "a\tb\nc\td");
  // CodeMirror's own paste takes the synthetic event and inserts the text
  // as it was; no table was written.
  await expect(editor).toContainText("\\begin{verbatim}");
  await expect(editor).not.toContainText("a & b");
});

test("a pasted image is saved under figures and a figure environment is written", async ({
  tab, project,
}) => {
  await expect(tab.locator(".cm-editor")).toBeVisible({ timeout: 45_000 });
  const editor = tab.locator(".cm-content");
  await editor.click();
  await tab.keyboard.press("Control+End");
  await tab.keyboard.press("Enter");
  await editor.evaluate((content) => {
    // A one-pixel PNG.
    const bytes = Uint8Array.from(atob(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVQI12P4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC",
    ), (char) => char.charCodeAt(0));
    const data = new DataTransfer();
    data.items.add(new File([bytes], "image.png", { type: "image/png" }));
    content.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }));
  });
  await expect(editor).toContainText("\\includegraphics[width=0.8\\linewidth]{figures/pasted-", { timeout: 15_000 });
  await expect(editor).toContainText("\\begin{figure}[htbp]");
  const figures = join(project.root, "figures");
  await expect.poll(() => existsSync(figures) && readdirSync(figures).some((name) => name.startsWith("pasted-") && name.endsWith(".png")), {
    timeout: 15_000,
  }).toBe(true);
});
