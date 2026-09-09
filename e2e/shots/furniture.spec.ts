import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { test, expect, openProject } from "../fixtures";

/** Not a check -- a look.  The editor's furniture rather than its text.
 *
 *  The syntax shots answer "can this be read on that page".  These answer
 *  the other half: the gutter, the active line, a selection, the caret, the
 *  find panel, the completion list and a hover tooltip are all drawn from
 *  the same palette, and every one of them was chosen against the proofing
 *  grey.  A ground two shades brighter moves the ones built from an alpha
 *  mix -- the active line is 7% of --ink-3, the selection is a wash -- and
 *  a wash that reads as a highlight on grey can vanish on white without
 *  anything failing anywhere.
 */

const SAMPLE = String.raw`\documentclass[12pt]{report}
\usepackage{amsmath}

\begin{document}
\section{Motivation}
\label{sec:motivation}

Internal conversion proceeds through a conical intersection, and the
selection below is here to be looked at rather than read.

\begin{equation}
  \label{eq:tdse}
  i\hbar \frac{\partial \Psi}{\partial t} = \hat{H} \Psi
\end{equation}

The energy $E = mc^2$ appears in the middle of a sentence.
\end{document}
`;

const GROUNDS = [
  { name: "light", theme: "light", editor: "match" },
  { name: "white", theme: "light", editor: "white" },
  { name: "warm", theme: "light", editor: "warm" },
  { name: "cool", theme: "light", editor: "cool" },
  { name: "dark", theme: "dark", editor: "match" },
] as const;

for (const ground of GROUNDS) {
  test(`furniture ${ground.name}`, async ({ app, project, page }) => {
    writeFileSync(join(project.root, "main.tex"), SAMPLE);
    await page.goto(`${app.base}/?token=${app.token}`);
    await page.evaluate((g) => {
      window.localStorage.setItem("nexttex.theme", g.theme);
      window.localStorage.setItem("nexttex.editor.theme", g.editor);
      window.localStorage.setItem("nexttex.editor.syntax", "colour");
    }, ground);
    await page.reload();
    await page.getByText("Projects", { exact: false }).first().waitFor();
    await openProject(page, project.root);
    const editor = page.locator(".cm-editor");
    await expect(editor).toBeVisible({ timeout: 30_000 });
    await page.waitForTimeout(1200);

    // A selection, the caret, the active line and the gutter, together --
    // and the find panel over the top of them, because the panel's own
    // border is drawn with --line, which is the token that weakens on a
    // brighter page.
    await page.locator(".cm-content").click();
    await page.keyboard.press("Control+Home");
    await page.keyboard.press("Control+ArrowDown");
    for (let i = 0; i < 7; i += 1) await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Shift+ArrowDown");
    await page.keyboard.press("Shift+End");
    await page.waitForTimeout(200);
    await editor.screenshot({ path: `shots/out-furniture-${ground.name}-selection.png` });

    await page.keyboard.press("Control+f");
    await expect(page.locator(".cm-panel.cm-search")).toBeVisible();
    await page.keyboard.type("conical");
    await page.waitForTimeout(400);
    await editor.screenshot({ path: `shots/out-furniture-${ground.name}-search.png` });
    await page.keyboard.press("Escape");

    // The completion list, which is furniture drawn over the text rather
    // than in it, and the one surface here with its own background.
    await page.locator(".cm-content").click();
    await page.keyboard.press("Control+End");
    await page.keyboard.type("\n\\ref{");
    await expect(page.locator(".cm-tooltip-autocomplete")).toBeVisible({
      timeout: 10_000,
    });
    await page.waitForTimeout(300);
    await editor.screenshot({ path: `shots/out-furniture-${ground.name}-complete.png` });
    await page.keyboard.press("Escape");

    // And a hover tooltip, which is KaTeX on a floating surface: the one
    // piece of this that is not drawn by our own stylesheet at all.  The
    // exact pixel of one character, because a `.cm-line` is as wide as the
    // pane and hovering the middle of it hovers empty space past the text.
    const point = await page.evaluate(() => {
      const line = [...document.querySelectorAll(".cm-line")].find((el) =>
        el.textContent?.includes("The energy"),
      );
      if (!line) return null;
      const target = line.textContent!.indexOf("mc^2") + 1;
      const walker = document.createTreeWalker(line, NodeFilter.SHOW_TEXT);
      let seen = 0;
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        const length = node.textContent!.length;
        if (seen + length > target) {
          const range = document.createRange();
          range.setStart(node, target - seen);
          range.setEnd(node, target - seen + 1);
          const box = range.getBoundingClientRect();
          return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
        }
        seen += length;
      }
      return null;
    });
    if (point) await page.mouse.move(point.x, point.y);
    await page.waitForTimeout(1200);
    await editor.screenshot({ path: `shots/out-furniture-${ground.name}-hover.png` });
  });
}
