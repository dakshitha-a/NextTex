import { test, expect, openProject } from "../fixtures";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/** The real Sections drawer, for the direction page's "One line on the
 *  page, and the drawer read as typeset": Typeset, Sections and Figures
 *  in both themes, and the drawing beside them. Not a check. Run with
 *  SHOTS=<dir> DRAWING=<direction.html> and the review config. */
const OUT = process.env.SHOTS ?? "/tmp";
const HOUSE = String.raw`\newcommand{\backmatter}[1]{\section*{#1}\addcontentsline{toc}{section}{#1}}
`;
const MAIN = String.raw`\documentclass{article}
\usepackage{house}
\newcommand{\Sz}{\ensuremath{\mathrm{S_0}}}
\begin{document}
\section*{Preface}\addcontentsline{toc}{section}{Preface}
The preface.
\section{Introduction to the \Sz{} state}
\input{chapters/one}
\section{What this means for the $\mathrm{NH}(X\,^3\Sigma^-)$ signal}
\begin{figure}[h]\rule{2cm}{1cm}\caption{Both routes to NH + CH$_4$ on one energy axis, relative to the \Sz{} minimum.}\label{fig:a}\end{figure}
See Figure~\ref{fig:a}.
\section{Conclusions}
\backmatter{Data availability}
\end{document}
`;
const ONE = String.raw`\subsection{Which surface carries the NH + CH$_4$ channel?}
\subsection{\texorpdfstring{Population dynamics with $\omega$B97XD}{Population dynamics with wB97XD}}
`;

for (const theme of ["dark", "light"]) {
  test(`the drawer, ${theme}`, async ({ app, project, page }) => {
    mkdirSync(join(project.root, "chapters"), { recursive: true });
    writeFileSync(join(project.root, "house.sty"), HOUSE);
    writeFileSync(join(project.root, "main.tex"), MAIN);
    writeFileSync(join(project.root, "chapters", "one.tex"), ONE);
    await page.goto(`${app.base}/?token=${app.token}`);
    await page.getByText("Projects", { exact: false }).first().waitFor();
    await openProject(page, project.root);
    if (theme === "light") {
      await page.getByTestId("appearance").first().click();
      await page.getByTestId("theme-light").click();
      await page.keyboard.press("Escape");
    }
    await expect(page.locator(".nx-text-layer span", { hasText: "preface" }).first()).toBeAttached({ timeout: 60_000 });
    await page.getByTestId("bar-sections").click();
    const drawer = page.getByTestId("drawer");
    await page.getByTestId("structure-typeset").click();
    await expect(page.getByTestId("typeset-row").filter({ hasText: "Introduction" })).toContainText("p. ", { timeout: 30_000 });
    await drawer.screenshot({ path: `${OUT}/real-${theme}-typeset.png` });
    await page.getByTestId("structure-sections").click();
    await page.waitForTimeout(800);
    await drawer.screenshot({ path: `${OUT}/real-${theme}-sections.png` });
    await page.getByTestId("structure-figures").click();
    await expect(page.getByTestId("figure-row").first()).toContainText("p. ", { timeout: 30_000 });
    await drawer.screenshot({ path: `${OUT}/real-${theme}-figures.png` });
  });
}

test("the drawing", async ({ page }) => {
  test.skip(!process.env.DRAWING, "no drawing given");
  await page.goto(`file://${process.env.DRAWING}`);
  for (const id of ["flDark", "flLight"]) {
    const el = page.locator(`#${id}`);
    await el.scrollIntoViewIfNeeded();
    await page.waitForTimeout(500);
    await el.screenshot({ path: `${OUT}/drawing-${id}.png` });
  }
});
