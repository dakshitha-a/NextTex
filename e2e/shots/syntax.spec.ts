import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { test, expect, openProject } from "../fixtures";

/** Not a check -- a look.  The syntax families, in every combination of
 *  interface theme and editor theme, with the colouring off and on. */

const SAMPLE = String.raw`\documentclass[12pt]{report}
\usepackage{amsmath}
\usepackage[margin=1in]{geometry}
\newcommand{\ONP}{\textit{o}-nitrophenol}

\begin{document}
\chapter{EXCITED STATE DYNAMICS}
\section{Motivation}
% The paragraph below is a comment and must stay grey.
Internal conversion in \ONP{} proceeds through a conical
intersection~\cite{Matsika2011}, as shown by earlier work\citep{Singh2019}.
\label{sec:motivation}

\subsection{The coupled equations}
\begin{equation}
  \label{eq:tdse}
  i\hbar \frac{\partial \Psi}{\partial t} = \hat{H} \Psi
\end{equation}

\begin{align}
  \sigma_{ij} &= \sum_{k} \alpha_k \beta_k \\
              &\approx \int_0^\infty \Omega(\tau)\, d\tau
\end{align}

Equation~\eqref{eq:tdse} follows from Ref.~\ref{sec:motivation}.

\begin{table}[t]
  \centering
  \caption{Vertical excitation energies.}
  \begin{tabular}{lcc}
    \toprule
    State & Energy & Oscillator strength \\
    \midrule
    $S_1$ & 3.94 & 0.0012 \\
    \bottomrule
  \end{tabular}
\end{table}

\begin{figure}
  \includegraphics[width=0.8\textwidth]{figures/pes.pdf}
  \caption{Potential energy surfaces along the \\
    dissociation coordinate.}
\end{figure}

\bibliographystyle{unsrt}
\bibliography{references}
\end{document}
`;

const CASES = [
  { name: "dark-match-colour",  theme: "dark",  editor: "match", syntax: "colour" },
  { name: "light-match-colour", theme: "light", editor: "match", syntax: "colour" },
  // The combination most likely to expose a token certified against only
  // one background: a light page inside a dark frame.
  { name: "dark-lightpage-colour", theme: "dark",  editor: "light", syntax: "colour" },
  { name: "light-darkpage-colour", theme: "light", editor: "dark",  syntax: "colour" },
  // And the default, which this setting exists not to change.
  { name: "dark-match-subtle",  theme: "dark",  editor: "match", syntax: "subtle" },
  { name: "light-match-subtle", theme: "light", editor: "match", syntax: "subtle" },
  // The three paper grounds, which are the whole reason the setting exists:
  // a writer who has only ever composed on white.  They are the light
  // palette with its surfaces moved up and nothing else changed, so the
  // question they ask is whether colours certified against the proofing
  // grey still hold against a page that is two shades brighter.  Both
  // modes, because on a white page the near-monochrome one is the harder
  // case: it has only weight and italics to work with.
  { name: "white-colour", theme: "light", editor: "white", syntax: "colour" },
  { name: "warm-colour",  theme: "light", editor: "warm",  syntax: "colour" },
  { name: "cool-colour",  theme: "light", editor: "cool",  syntax: "colour" },
  { name: "white-subtle", theme: "light", editor: "white", syntax: "subtle" },
  { name: "warm-subtle",  theme: "light", editor: "warm",  syntax: "subtle" },
  // A white page inside a dark frame, which is the arrangement most likely
  // to expose furniture that was only ever checked against its own theme.
  { name: "dark-whitepage-colour", theme: "dark", editor: "white", syntax: "colour" },
];

for (const shot of CASES) {
  test(`syntax ${shot.name}`, async ({ app, project, page }) => {
    writeFileSync(join(project.root, "main.tex"), SAMPLE);
    await page.goto(`${app.base}/?token=${app.token}`);
    await page.evaluate((s) => {
      window.localStorage.setItem("nexttex.theme", s.theme);
      window.localStorage.setItem("nexttex.editor.theme", s.editor);
      window.localStorage.setItem("nexttex.editor.syntax", s.syntax);
    }, shot);
    await page.reload();
    await page.getByText("Projects", { exact: false }).first().waitFor();
    await openProject(page, project.root);
    await expect(page.locator(".cm-editor")).toBeVisible({ timeout: 30_000 });
    await page.waitForTimeout(1500);
    await page.locator(".cm-editor").screenshot({
      path: `shots/out-syntax-${shot.name}.png`,
    });
  });
}
