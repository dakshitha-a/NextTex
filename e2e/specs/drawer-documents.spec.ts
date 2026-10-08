import { test, expect, openProject } from "../fixtures";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Page } from "@playwright/test";

/** The Sections drawer across two documents that share a chapter.
 *
 *  The writer asked for the drawer to be audited on 8 October 2026: the
 *  headings of the file in the editor, the figures and the typeset index
 *  of the document in the preview, each right when several documents are
 *  edited and built. The audit, over copies of the writer's own papers,
 *  found titles doubled by `\texorpdfstring`, maths read as "CH _4", the
 *  writer's macros dropped from captions, a long caption read as empty, a
 *  class's back matter missing from the index, and every number after a
 *  starred heading with its own contents line taken from the one before.
 */

const HOUSE = String.raw`\newcommand{\backmatter}[1]{%
  \section*{#1}\addcontentsline{toc}{section}{#1}}
`;
const MAIN = String.raw`\documentclass{article}
\usepackage{house}
\newcommand{\Sz}{\ensuremath{\mathrm{S_0}}}
\begin{document}
\section*{Preface}\addcontentsline{toc}{section}{Preface}
The preface of the thesis.

\section{Introduction to the \Sz{} state}
The thesis opens here.

\section{\texorpdfstring{Dynamics with $\omega$B97XD}{Dynamics with wB97XD}}
Words about the methane, CH$_4$.

\begin{figure}[h]
\rule{2cm}{1cm}
\caption{The \Sz{} minimum of CH$_4$. @CAPTION@}
\label{fig:main}
\end{figure}

\input{chapters/shared}
\end{document}
`.replace("@CAPTION@", "The long caption goes on about the levels between the routes. ".repeat(30));
const SI = String.raw`\documentclass{article}
\usepackage{house}
\begin{document}
\section{Supporting methods}
The supporting document's own words.

\begin{figure}[h]
\rule{2cm}{1cm}
\caption{The supporting figure.}
\label{fig:si}
\end{figure}

\newpage
\input{chapters/shared}

\backmatter{Data availability}
The data are available.
\end{document}
`;
const SHARED = String.raw`\section{Shared chapter}
The shared chapter is read by both documents.

\begin{figure}[h]
\rule{2cm}{1cm}
\caption{The shared figure of the omega model.}
\label{fig:shared}
\end{figure}
`;

async function setUp(app: { base: string; token: string }, project: { root: string }, page: Page) {
  mkdirSync(join(project.root, "chapters"), { recursive: true });
  writeFileSync(join(project.root, "house.sty"), HOUSE);
  writeFileSync(join(project.root, "main.tex"), MAIN);
  writeFileSync(join(project.root, "si.tex"), SI);
  writeFileSync(join(project.root, "chapters", "shared.tex"), SHARED);
  await page.goto(`${app.base}/?token=${app.token}`);
  await page.getByText("Projects", { exact: false }).first().waitFor();
  await openProject(page, project.root);
  await expect(page.locator(".nx-text-layer span", { hasText: "thesis" }).first()).toBeAttached({ timeout: 60_000 });
  await drawer(page, "sections");
}

/** One drawer of the activity bar in front, without shutting it when it
 *  already is. */
async function drawer(page: Page, id: "files" | "sections") {
  const button = page.getByTestId(`bar-${id}`);
  if ((await button.getAttribute("aria-pressed")) !== "true") await button.click();
}

/** Open a file from the tree, and come back to the Sections drawer. */
async function openFile(page: Page, path: string) {
  await drawer(page, "files");
  const parts = path.split("/");
  if (parts.length > 1 && !(await page.locator(`[role="tree"] [data-path="${path}"]`).count())) {
    await page.locator(`[role="tree"] [data-path="${parts[0]}"]`).click();
  }
  await page.locator(`[role="tree"] [data-path="${path}"]`).click();
  await expect(page.locator(`[data-tab][data-path="${path}"] button[aria-current="true"]`)).toBeVisible({ timeout: 15_000 });
  await drawer(page, "sections");
}

async function previewSi(page: Page) {
  await page.getByTestId("add-preview").click();
  await page.getByRole("menuitem", { name: "si.tex" }).click();
  await expect(page.getByTestId("preview-tab-si.tex")).toHaveAttribute("aria-current", "true");
  await expect(page.locator(".nx-text-layer span", { hasText: "supporting" }).first()).toBeAttached({ timeout: 60_000 });
}

const labels = (page: Page, testid: string) =>
  page.getByTestId(testid).locator(".nx-row-label").allTextContents();

test("Sections lists the file in the editor, its maths, macros and the project's heading commands", async ({
  app, project, page,
}) => {
  await setUp(app, project, page);
  await page.getByTestId("structure-sections").click();
  await expect.poll(() => labels(page, "section-row"), { timeout: 20_000 }).toEqual([
    "Preface", "Introduction to the S₀ state", "Dynamics with ωB97XD", "shared",
  ]);
  await openFile(page, "si.tex");
  // `\backmatter` is defined in house.sty, which this file cannot see.
  await expect.poll(() => labels(page, "section-row"), { timeout: 20_000 }).toEqual([
    "Supporting methods", "shared", "Data availability",
  ]);
  await openFile(page, "chapters/shared.tex");
  await expect.poll(() => labels(page, "section-row"), { timeout: 20_000 }).toEqual(["Shared chapter"]);
});

test("Typeset and Figures follow the preview tab, with each document's numbers and pages", async ({
  app, project, page,
}) => {
  await setUp(app, project, page);
  await page.getByTestId("structure-typeset").click();
  const rows = page.getByTestId("typeset-row");
  await expect.poll(() => rows.locator(".nx-row-label").allTextContents(), { timeout: 30_000 }).toEqual([
    "Preface", "Introduction to the S₀ state", "Dynamics with ωB97XD", "Shared chapter",
  ]);
  // The starred Preface adds its own contents line; the headings after
  // it keep their own numbers.
  await expect(rows.filter({ hasText: "Introduction" }).locator(".nx-typeset-number")).toHaveText("1", { timeout: 30_000 });
  await expect(rows.filter({ hasText: "Shared chapter" }).locator(".nx-typeset-number")).toHaveText("3");
  await expect(rows.filter({ hasText: "Preface" })).toContainText("p. 1");

  await page.getByTestId("structure-figures").click();
  const figures = page.getByTestId("figure-row");
  await expect(figures).toHaveCount(2, { timeout: 30_000 });
  // A caption past twelve hundred characters, with the writer's macro
  // written out and the maths as set.
  await expect(figures.first()).toContainText("The S₀ minimum of CH₄. The long caption");
  await expect(figures.nth(1)).toContainText(/Figure 2\s*p\. \d/);

  // The two-column document in front: its own index and figures.
  await previewSi(page);
  await expect.poll(() => figures.locator(".nx-row-label").allTextContents(), { timeout: 30_000 })
    .toEqual([expect.stringMatching(/^Figure 1/), expect.stringMatching(/^Figure 2/)]);
  await expect(figures.nth(1)).toContainText("The shared figure");
  await page.getByTestId("structure-typeset").click();
  await expect.poll(() => rows.locator(".nx-row-label").allTextContents(), { timeout: 30_000 }).toEqual([
    "Supporting methods", "Shared chapter", "Data availability",
  ]);
  // The shared chapter is section 2 here, after a page break.
  await expect(rows.filter({ hasText: "Shared chapter" }).locator(".nx-typeset-number")).toHaveText("2", { timeout: 30_000 });
  await expect(rows.filter({ hasText: "Shared chapter" })).toContainText("p. 2");
  // The back matter, made by the class's command, has its page.
  await expect(rows.filter({ hasText: "Data availability" })).toContainText("p. 2");
});

test("a Typeset row shows its place on the page of the document in front", async ({ app, project, page }) => {
  await setUp(app, project, page);
  await previewSi(page);
  await page.getByTestId("structure-typeset").click();
  const rows = page.getByTestId("typeset-row");
  const pageNumber = () => page.getByLabel("Page", { exact: true }).inputValue().catch(() => "0");
  const shared = rows.filter({ hasText: "Shared chapter" });
  await expect(shared).toContainText("p. 2", { timeout: 30_000 });
  await shared.click();
  await expect.poll(pageNumber, { timeout: 10_000 }).toBe("2");

  // The same chapter with main in front is where main sets it. The page
  // is shown first, so the press has somewhere to move from.
  await page.getByTestId("preview-tab-main.tex").click();
  await expect(page.locator(".nx-text-layer span", { hasText: "thesis" }).first()).toBeAttached({ timeout: 30_000 });
  await expect(rows.filter({ hasText: "Introduction" })).toBeVisible({ timeout: 30_000 });
  await rows.filter({ hasText: "Preface" }).click();
  await expect.poll(pageNumber, { timeout: 10_000 }).toBe("1");
  const inMain = rows.filter({ hasText: "Shared chapter" });
  const want = ((await inMain.locator(".nx-typeset-page").textContent()) ?? "").replace(/\D/g, "");
  expect(want).not.toBe("1");
  await inMain.click();
  await expect.poll(pageNumber, { timeout: 10_000 }).toBe(want);
});

// The list's lines are the text's when it was last asked for, which is
// after a build, and the page is that build's: the row is found again in
// the text as it is now and carried back, never shifted twice.
test("a Typeset row lands on its heading after lines are written above it, before the build", async ({
  app, project, page,
}) => {
  const flashes: string[] = [];
  await page.exposeFunction("sawFlash", (top: string) => flashes.push(top));
  await page.addInitScript(() => {
    new MutationObserver((records) => {
      for (const record of records) {
        for (const node of record.addedNodes) {
          if (!(node instanceof HTMLElement) || !node.classList.contains("nx-flash")) continue;
          const on = node.closest(".nx-page") as HTMLElement;
          const span = [...on.querySelectorAll(".nx-text-layer span")].find((s) => (s.textContent ?? "").includes("Shared chapter"));
          const top = parseFloat(node.style.top);
          const height = parseFloat(node.style.height);
          let verdict = "no heading on the page";
          if (span) {
            const box = on.getBoundingClientRect();
            const rect = span.getBoundingClientRect();
            const middle = rect.top + rect.height / 2 - box.top - on.clientTop;
            verdict = middle >= top && middle <= top + height ? "ok" : "misses the heading";
          }
          (window as unknown as { sawFlash: (v: string) => void }).sawFlash(verdict);
        }
      }
    }).observe(document, { childList: true, subtree: true });
  });
  await setUp(app, project, page);
  await page.getByTestId("structure-typeset").click();
  const shared = page.getByTestId("typeset-row").filter({ hasText: "Shared chapter" });
  await expect(shared).toContainText("p. ", { timeout: 30_000 });
  await openFile(page, "chapters/shared.tex");
  await page.locator(".cm-content:visible .cm-line").first().click();
  await page.keyboard.press("Home");
  await page.keyboard.insertText("A new first line.\n\nAnd a paragraph above the heading.\n\n");
  flashes.length = 0;
  await shared.click();
  await expect.poll(() => flashes.length, { timeout: 10_000 }).toBeGreaterThan(0);
  expect(flashes).toEqual(["ok"]);
});
