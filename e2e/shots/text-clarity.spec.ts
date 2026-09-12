import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { test, expect, openProject } from "../fixtures";

/** Not a check, a look: how the editor's text is actually rasterised.
 *
 *  Every other question about the palette is answerable by arithmetic and
 *  `contrast.test.ts` answers it.  This one is not.  Whether a stroke is
 *  crisp or soft on a given ground is a question about hinting, stem
 *  placement and the weight the face was drawn at, and the two occasions
 *  this was got wrong before were both got wrong by reasoning and both
 *  caught by eye.
 *
 *  Read the caveat before reading the shots.  Headless Chromium has no LCD
 *  subpixel antialiasing and its fontconfig may not be the desktop's, so
 *  these compare weight, fit and letterform honestly, and subpixel
 *  rendering not at all.
 */

// Comment-heavy on purpose. Comments are --ink-3 and italic, which is the
// faintest and, until the italic faces were imported, the worst drawn text
// in the editor: the place any softness shows first.
const SAMPLE = String.raw`% Draft three. The argument in section 2 still assumes
% adiabatic separation, which is exactly what the referee
% objected to. Rewrite before Friday.
\documentclass[12pt]{report}
\usepackage{amsmath}

\begin{document}
\section{Motivation}          % promoted from a subsection
\label{sec:motivation}

Internal conversion proceeds through a conical intersection at
$1.86\,\mathrm{eV}$, and the population transfer is complete within
\SI{40}{\femto\second} of the pump pulse.

\emph{Emphasis is set in the same italic the comments are.}
\end{document}
`;

const GROUNDS = ["white", "warm", "cool", "match", "dark"] as const;

/** What each candidate does to the page, as a stylesheet injected after the
 *  app has settled.  `now` is the code as it stands. */
const CANDIDATES: Record<string, string> = {
  now: "",
  // The compensation the light palette adds to the writer's chosen weight.
  // Authored against the proofing grey; pure white is nine points brighter.
  "lift-0": ".nx-theme-white, .nx-theme-warm, .nx-theme-cool { --nx-editor-weight-lift: 0; }",
  // 7% of --ink-3 lightens a dark ground and darkens a bright one, so on
  // white the one line whose text most needs to be crisp is the one line
  // sitting on a grey band.
  "no-active-wash": ".cm-editor .cm-activeLine { background: transparent; }",
  // 13.5px is the only fractional stop on the size ladder.  The gutter used
  // to be a fraction at every stop and is not any more, so there is no
  // gutter candidate here: it would render the same shot twice.  This one
  // is the text, and it is kept because the answer was to leave the ladder
  // alone and the shot is what says why.
  "whole-px": ".cm-editor .cm-scroller { font-size: 14px; }",
};

for (const ground of GROUNDS) {
  for (const candidate of Object.keys(CANDIDATES)) {
    // The two that only make sense on a bright page are not rendered on the
    // dark one, where there is nothing for them to change.
    if (ground === "dark" && candidate !== "now") continue;
    test(`clarity ${ground} ${candidate}`, async ({ app, project, browser }) => {
      writeFileSync(join(project.root, "main.tex"), SAMPLE);
      // Its own context, at two device pixels, because a stem landing off
      // the grid is the whole subject and one pixel per pixel hides it.
      const context = await browser.newContext({
        deviceScaleFactor: Number(process.env.NEXTTEX_SHOT_DPR ?? 2),
        viewport: { width: 1100, height: 800 },
      });
      const page = await context.newPage();
      await page.goto(`${app.base}/?token=${app.token}`);
      await page.evaluate((g) => {
        window.localStorage.setItem("nexttex.theme", g === "dark" ? "dark" : "light");
        window.localStorage.setItem("nexttex.editor.theme", g);
        window.localStorage.setItem("nexttex.editor.syntax", "colour");
      }, ground);
      await page.reload();
      await page.getByText("Projects", { exact: false }).first().waitFor();
      await openProject(page, project.root);
      const editor = page.locator(".cm-editor");
      await expect(editor).toBeVisible({ timeout: 30_000 });
      const extra = CANDIDATES[candidate];
      if (extra) await page.addStyleTag({ content: extra });
      // The caret on a line in the middle, so the active line wash is
      // somewhere the crop will show it.
      await page.locator(".cm-content").click();
      await page.keyboard.press("Control+Home");
      for (let i = 0; i < 10; i += 1) await page.keyboard.press("ArrowDown");
      await page.waitForTimeout(900);
      await editor.screenshot({
        // Named by the ratio whenever it is not the 2 this was tuned at.
        // 1.25 is the one that was missing and it is the ordinary default
        // on a Windows laptop at 125 per cent scaling: the clarity work
        // here is about whole-pixel alignment, gutters and hairlines, and
        // a fractional ratio is exactly where whole-pixel reasoning stops
        // holding. A rule that lands on a boundary at 1 and at 2 lands
        // between pixels at 1.25.
        path: `shots/out-clarity-${ground}-${candidate}${
          process.env.NEXTTEX_SHOT_DPR && process.env.NEXTTEX_SHOT_DPR !== "2"
            ? `-${process.env.NEXTTEX_SHOT_DPR}x`
            : ""
        }.png`,
        clip: { x: 0, y: 0, width: 560, height: 300 },
      });
      await context.close();
    });
  }
}
