import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { test, expect, openProject } from "../fixtures";

/** Not a check -- a look.  What the underline reads like beside the
 *  diagnostic marks it must not be confused with. */

const SAMPLE = String.raw`\documentclass{report}
\usepackage{amsmath}

\begin{document}
\section{Teh motivation}
Internal conversion in nitrophenol proceeds through a conical
intersection~\cite{Matsika2011}, wiht the calculation showing that
the excited-state population decays on a picosecond timescale.

\label{sec:motivation}
\begin{equation}
  \sigma_{ij} = \sum_k \alpha_k \beta_k
\end{equation}
\end{document}
`;

for (const theme of ["light", "dark"]) {
  test(`spelling ${theme}`, async ({ app, project, page }) => {
    writeFileSync(join(project.root, "main.tex"), SAMPLE);
    await page.goto(`${app.base}/?token=${app.token}`);
    await page.evaluate((t) => {
      window.localStorage.setItem("nexttex.theme", t);
      window.localStorage.setItem("nexttex.editor.syntax", "colour");
      window.localStorage.setItem("nexttex.editor.spelling", "on");
    }, theme);
    await page.reload();
    await page.getByText("Projects", { exact: false }).first().waitFor();
    await openProject(page, project.root);
    await expect(page.locator(".nx-misspelled").first()).toBeVisible({
      timeout: 30_000,
    });
    await page.waitForTimeout(1200);
    await page.locator(".cm-editor").screenshot({
      path: `shots/out-spelling-${theme}.png`,
    });
  });
}
