import { test, expect, openProject } from "../fixtures";
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Page } from "@playwright/test";

/** A citation opens its paper (27 October 2026).
 *
 *  The writer asked for a citation's hover card, and its entry in the
 *  typeset bibliography, to open the paper when its PDF is on disk, and
 *  its DOI page when it is not. The PDF here is named after its key and
 *  buried three folders deep, as in the writer's thesis, and lands after
 *  the project is open, so the watcher is what finds it. A click that
 *  would open a browser tab is caught at `window.open`.
 */

// The smallest file pdf.js opens: one empty page.
const PDF = "%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n";

const TULLY = "\n@article{tully1990,\n  author = {Tully, John C.},\n  title = {Molecular dynamics with electronic transitions},\n  doi = {10.1063/1.459170},\n  year = {1990},\n}\n";

function bury(root: string) {
  const folder = join(root, "literature", "books", "1984");
  mkdirSync(folder, { recursive: true });
  writeFileSync(join(folder, "knuth1984.pdf"), PDF);
}

/** Catch what a click would open in a browser tab. */
async function catchOpens(page: Page) {
  await page.evaluate(() => {
    const opened: string[] = [];
    (window as unknown as { opened: string[] }).opened = opened;
    window.open = ((url?: string | URL) => {
      opened.push(String(url));
      return null;
    }) as typeof window.open;
  });
}

const opened = (page: Page) => page.evaluate(() => (window as unknown as { opened: string[] }).opened);

/** Write a line at the end of the open file and hover a token in it, again
 *  until the card holds `ready`: the PDF list reaches the browser a moment
 *  after the file lands. */
async function hoverCite(page: Page, line: string, token: string, ready: string) {
  await expect(page.locator(".cm-editor")).toBeVisible({ timeout: 30_000 });
  await page.locator(".cm-content").click();
  await page.keyboard.press("Control+End");
  await page.keyboard.type(`\n${line}`);
  const tip = page.locator(".nx-link-tooltip");
  await expect.poll(async () => {
    await page.mouse.move(5, 5);
    await page.waitForTimeout(150);
    const point = await page.evaluate(({ line, token }) => {
      const row = [...document.querySelectorAll(".cm-line")].find((el) => el.textContent?.includes(line));
      if (!row) return null;
      const at = row.textContent!.indexOf(token) + 2;
      const walker = document.createTreeWalker(row, NodeFilter.SHOW_TEXT);
      let seen = 0;
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        const length = node.textContent!.length;
        if (seen + length > at) {
          const range = document.createRange();
          range.setStart(node, at - seen);
          range.setEnd(node, at - seen + 1);
          const box = range.getBoundingClientRect();
          return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
        }
        seen += length;
      }
      return null;
    }, { line, token });
    if (!point) return 0;
    await page.mouse.move(point.x, point.y);
    await page.mouse.move(point.x + 1, point.y);
    await tip.waitFor({ timeout: 3_000 }).catch(() => undefined);
    await page.waitForTimeout(300);
    return page.locator(ready).count();
  }, { timeout: 45_000, intervals: [700] }).toBeGreaterThan(0);
  return tip;
}

test("a citation's card opens its PDF, found three folders deep", async ({ project, tab }) => {
  bury(project.root);
  const tip = await hoverCite(tab, "As in \\cite{knuth1984}.", "knuth1984", '[data-testid="link-paper"]');
  await expect(tip.getByTestId("cite-paper-path")).toHaveText("literature/books/1984/knuth1984.pdf");
  const button = tip.getByTestId("link-paper");
  await expect(button).toHaveText("Open PDF");
  // The paper's verb comes first, before the key's own two.
  await expect(tip.locator(".nx-link-verbs button").first()).toHaveText("Open PDF");
  await button.click();
  await expect(tab.getByRole("button", { name: "knuth1984.pdf", exact: true }).first()).toBeVisible({ timeout: 10_000 });
});

test("a citation with no PDF but a DOI opens its DOI page", async ({ project, tab }) => {
  appendFileSync(join(project.root, "references.bib"), TULLY);
  const tip = await hoverCite(tab, "As in \\cite{tully1990}.", "tully1990", '[data-testid="link-paper"]');
  await expect(tip.getByTestId("link-paper")).toHaveText("Open DOI page");
  await expect(tip.getByTestId("cite-paper-path")).toHaveCount(0);
  await catchOpens(tab);
  await tip.getByTestId("link-paper").click();
  expect(await opened(tab)).toEqual(["https://doi.org/10.1063/1.459170"]);
});

const LAMPORT = "\n@book{lamport1994,\n  author = {Lamport, Leslie},\n  title = {LaTeX: A Document Preparation System},\n  year = {1994},\n}\n";

// Through BibTeX, as a real bibliography is, so a click on an entry lands
// in the generated `.bbl` rather than in a file the writer wrote.
const PAGE = (hyperref: boolean) => String.raw`\documentclass{article}
${hyperref ? "\\usepackage{hyperref}" : ""}
\begin{document}
Knuth wrote one book~\cite{knuth1984}, Tully a paper~\cite{tully1990}, and
Lamport another~\cite{lamport1994}.
\bibliographystyle{unsrt}
\bibliography{references}
\end{document}
`;

async function openBibliography(app: { base: string; token: string }, project: { root: string }, page: Page, hyperref: boolean) {
  writeFileSync(join(project.root, "main.tex"), PAGE(hyperref));
  appendFileSync(join(project.root, "references.bib"), TULLY + LAMPORT);
  bury(project.root);
  await page.goto(`${app.base}/?token=${app.token}`);
  await page.getByText("Projects", { exact: false }).first().waitFor();
  await openProject(page, project.root);
  await expect(page.locator(".nx-page").first().locator(".nx-text-layer span", { hasText: "Document Preparation" }).first())
    .toBeAttached({ timeout: 60_000 });
  // The editor has read the bibliography, so the preview knows the DOIs.
  await expect(page.locator(".cm-editor")).toBeVisible({ timeout: 30_000 });
}

test("an entry in the typeset bibliography opens its paper on a click", async ({ app, project, page }) => {
  await openBibliography(app, project, page, true);
  const knuth = page.locator('.nx-page-link[data-paper="knuth1984"]');
  const tully = page.locator('.nx-page-link[data-paper="tully1990"]');
  const lamport = page.locator('.nx-page-link[data-paper="lamport1994"]');
  await expect(knuth).toBeAttached({ timeout: 20_000 });
  // Each box covers its own entry and no other.
  const boxes = await Promise.all([knuth, tully, lamport].map((one) => one.boundingBox()));
  expect(boxes[0]!.y + boxes[0]!.height).toBeLessThanOrEqual(boxes[1]!.y + 1);
  expect(boxes[1]!.y + boxes[1]!.height).toBeLessThanOrEqual(boxes[2]!.y + 1);

  // The PDF list arrives after the page: hovered until the entry says so.
  await expect.poll(async () => {
    await page.mouse.move(5, 5);
    await knuth.hover();
    return knuth.getAttribute("title");
  }, { timeout: 20_000 }).toBe("Open PDF");
  await expect(knuth).toHaveAttribute("data-open", "");

  // An entry with nothing to open is text: no label, no link cursor.
  await lamport.hover();
  await expect(lamport).not.toHaveAttribute("data-open", "");
  expect(await lamport.evaluate((el) => getComputedStyle(el).cursor)).toBe("text");

  await catchOpens(page);
  await tully.hover();
  await expect(tully).toHaveAttribute("title", "Open DOI page");
  await tully.click();
  expect(await opened(page)).toEqual(["https://doi.org/10.1063/1.459170"]);

  // The page menu over an entry offers its paper, read off the box, and
  // asks SyncTeX nothing; nor does a right-click elsewhere on this page,
  // whose entries all have boxes.
  const asked: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes("/synctex/inverse")) asked.push(request.url());
  });
  await tully.click({ button: "right" });
  await expect(page.getByRole("menuitem", { name: "Open this reference" })).toBeVisible();
  await page.keyboard.press("Escape");
  await page.locator(".nx-page").first().locator(".nx-text-layer span", { hasText: "Knuth wrote" }).first().click({ button: "right" });
  await expect(page.getByRole("menuitem", { name: "Show this in the source" })).toBeVisible();
  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);
  expect(asked).toEqual([]);

  await knuth.click();
  await expect(page.getByRole("button", { name: "knuth1984.pdf", exact: true }).first()).toBeVisible({ timeout: 10_000 });
});

test("without hyperref the page menu offers the entry's paper", async ({ app, project, page }) => {
  await openBibliography(app, project, page, false);
  await expect(page.locator(".nx-page-link[data-paper]")).toHaveCount(0);
  const entry = page.locator(".nx-page").first().locator(".nx-text-layer span", { hasText: "Molecular dynamics" }).first();
  await catchOpens(page);
  await expect.poll(async () => {
    await page.keyboard.press("Escape");
    await entry.click({ button: "right" });
    return page.getByRole("menuitem", { name: "Open this reference" }).count();
  }, { timeout: 20_000, intervals: [500] }).toBeGreaterThan(0);
  await page.getByRole("menuitem", { name: "Open this reference" }).click();
  expect(await opened(page)).toEqual(["https://doi.org/10.1063/1.459170"]);
});
