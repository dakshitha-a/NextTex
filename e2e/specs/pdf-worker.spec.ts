import { test, expect } from "../fixtures";

/** Rebuilds share one pdf.js worker.
 *
 *  `getDocument` with no worker of its own makes one, and destroying the
 *  document ends it, so each rebuild started a Web Worker and compiled
 *  pdf.js's 1.3 MB worker script before it could read the new PDF: seven
 *  workers in six rebuilds, and about 330 ms from the PDF arriving to its
 *  first page drawn. One worker kept for the page took that to about 105.
 */
test("three rebuilds of the preview start one pdf.js worker", async ({ tab }) => {
  const count = await tab.evaluate(() => {
    const w = window as any;
    w.__pdfWorkers = 0;
    const Real = window.Worker;
    w.Worker = class extends Real {
      constructor(url: string | URL, options?: WorkerOptions) {
        super(url, options);
        if (String(url).includes("pdf.worker")) w.__pdfWorkers += 1;
      }
    };
    return w.__pdfWorkers as number;
  });
  expect(count).toBe(0);
  const pdfs: string[] = [];
  tab.on("requestfinished", (request) => {
    if (/\/pdf(\?|$)/.test(request.url())) pdfs.push(request.url());
  });
  await tab.locator(".cm-content").click();
  await tab.keyboard.press("Control+End");
  for (let i = 0; i < 3; i++) {
    const before = pdfs.length;
    await tab.keyboard.type(` again${i}`);
    await expect.poll(() => pdfs.length, { timeout: 30_000 }).toBeGreaterThan(before);
    await expect(tab.locator(".nx-page canvas").first()).toBeVisible({ timeout: 30_000 });
  }
  // The first document after the wrapper went in may have made the one
  // worker; no rebuild after it made another.
  expect(await tab.evaluate(() => (window as any).__pdfWorkers)).toBeLessThanOrEqual(1);
});
