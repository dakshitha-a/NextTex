import { test, expect, openProject } from "../fixtures";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Page } from "@playwright/test";

/** A click on a reference in the preview goes where the reference points.
 *
 *  The writer asked (17 October 2026) for the contents, the references to
 *  figures, tables and equations, and the citations to be links that take
 *  the reader to the thing they name. hyperref already writes them into
 *  the PDF; the canvas drew none of them. Each case clicks the link over a
 *  word on the first page and asks that the view moved to the page the
 *  thing is on and flashed a line there that is the thing.
 */

const MAIN = String.raw`\documentclass{article}
\usepackage{amsmath}
\usepackage{hyperref}
\begin{document}
\tableofcontents
\bigskip
As Figure~\ref{fig:ox} shows, and Table~\ref{tab:yak} lists, the balance
in Equation~\eqref{eq:emu} holds, which is what Knuth found~\cite{knuth}.
\clearpage
\section{Method}
The method is set on a page of its own.
\begin{equation}
  E = m c^2 \label{eq:emu}
\end{equation}
\clearpage
\section{Results}
\begin{figure}[h]
\centering
\rule{3cm}{2cm}
\caption{Ox in the field.}\label{fig:ox}
\end{figure}
\begin{table}[h]
\centering
\caption{Yak by the river.}\label{tab:yak}
\begin{tabular}{cc} a & b \end{tabular}
\end{table}
\clearpage
\begin{thebibliography}{9}
\bibitem{knuth} Donald Knuth. The TeXbook. Addison-Wesley, 1984.
\end{thebibliography}
\end{document}
`;

async function setUp(app: { base: string; token: string }, project: { root: string }, page: Page) {
  writeFileSync(join(project.root, "main.tex"), MAIN);
  await page.addInitScript(() => {
    const seen: HTMLElement[] = [];
    (window as unknown as { flashes: HTMLElement[] }).flashes = seen;
    new MutationObserver((records) => {
      for (const record of records) {
        for (const node of record.addedNodes) {
          if (node instanceof HTMLElement && node.classList.contains("nx-flash")) seen.push(node);
        }
      }
    }).observe(document, { childList: true, subtree: true });
  });
  await page.goto(`${app.base}/?token=${app.token}`);
  await page.getByText("Projects", { exact: false }).first().waitFor();
  await openProject(page, project.root);
  // The contents are filled in by latexmk's second pass, so the first
  // page is ready once its entry for Results is there and linked.
  await expect(page.locator(".nx-page").first().locator(".nx-text-layer span", { hasText: "Results" })).toBeAttached({ timeout: 60_000 });
  await expect(page.locator(".nx-page").first().locator('.nx-page-link[data-dest="cite.knuth"]')).toBeAttached({ timeout: 20_000 });
}

/** Click the first link on the first page whose destination's name
 *  starts with `name`, hyperref's `section.2` or `cite.knuth`, and say
 *  which page the view landed on and what the flash there covers. */
async function follow(page: Page, name: string) {
  await page.evaluate(() => {
    const first = document.querySelector(".nx-page") as HTMLElement;
    (first.closest(".overflow-auto") as HTMLElement).scrollTop = 0;
    (window as unknown as { flashes: HTMLElement[] }).flashes.length = 0;
  });
  const link = page.locator(".nx-page").first().locator(`.nx-page-link[data-dest^="${name}"]`).first();
  await link.click();
  await expect.poll(() => page.evaluate(() => (window as unknown as { flashes: HTMLElement[] }).flashes.length),
    { timeout: 10_000 }).toBeGreaterThan(0);
  return page.evaluate(() => {
    const flash = (window as unknown as { flashes: HTMLElement[] }).flashes[0];
    const on = flash.closest(".nx-page") as HTMLElement;
    const pages = [...document.querySelectorAll(".nx-page")];
    const scroller = on.closest(".overflow-auto") as HTMLElement;
    const view = scroller.getBoundingClientRect();
    const box = flash.getBoundingClientRect();
    const covered = [...on.querySelectorAll(".nx-text-layer span")]
      .filter((s) => {
        if (s.querySelector("span")) return false;
        const r = s.getBoundingClientRect();
        const y = r.top + r.height / 2;
        return y > box.top && y < box.bottom;
      })
      .map((s) => s.textContent)
      .join(" ");
    return {
      page: pages.indexOf(on) + 1,
      covered,
      // The landing place is on screen. It is near the top where the
      // document goes on far enough below it; the bibliography, on the
      // last page, is as high as the end of the document lets it be.
      inView: box.top >= view.top && box.bottom <= view.bottom,
      upper: box.bottom <= view.top + view.height / 2,
    };
  });
}

test("contents, references and citations in the preview go to what they name", async ({ app, project, page }) => {
  await setUp(app, project, page);
  // What each link is named, the page its place is on, and a word of
  // the line that place begins.
  const cases: [string, number, string][] = [
    ["section.2", 3, "Results"],
    ["section.1", 2, "Method"],
    ["equation.", 2, "(1)"],
    ["figure.", 3, "Ox"],
    ["table.", 3, "Yak"],
    ["cite.knuth", 4, "Knuth"],
  ];
  for (const [name, landed, line] of cases) {
    const where = await follow(page, name);
    expect(where.page, `${name} lands on page ${landed}`).toBe(landed);
    expect(where.covered, `${name} flashes the line it names`).toContain(line);
    expect(where.inView, `${name} is in view`).toBe(true);
    if (landed < 4) expect(where.upper, `${name} lands in the upper half of the view`).toBe(true);
  }
});

test("a double-click on a link follows it and does not also jump the editor", async ({ app, project, page }) => {
  await setUp(app, project, page);
  const requests: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes("/inverse")) requests.push(request.url());
  });
  const at = await page.locator(".nx-page").first().locator(".nx-page-link").first().boundingBox();
  await page.mouse.dblclick(at!.x + at!.width / 2, at!.y + at!.height / 2);
  await page.waitForTimeout(500);
  expect(requests).toEqual([]);
});
