import { test, expect, openProject } from "../fixtures";
import { writeFileSync } from "node:fs";
import { join } from "node:path";

/** The real editor after a double-click on the page, for the direction
 *  page's "A double-click selects its word": as it lands, and after the
 *  flash, in both themes. Not a check. */
const OUT = process.env.SHOTS ?? "/tmp";
const MAIN = String.raw`\documentclass{article}
\begin{document}
\section{Introduction}

The model predicts the state, and the model then corrects the state using the model of the noise. When the state drifts, the model is told about the drift.

Introduction of the method comes after the notation.
\end{document}
`;

for (const theme of ["dark", "light"]) {
  test(`the selected word, ${theme}`, async ({ app, project, page }) => {
    writeFileSync(join(project.root, "main.tex"), MAIN);
    await page.goto(`${app.base}/?token=${app.token}`);
    await page.getByText("Projects", { exact: false }).first().waitFor();
    await openProject(page, project.root);
    if (theme === "light") {
      await page.getByTestId("appearance").first().click();
      await page.getByTestId("theme-light").click();
      await page.keyboard.press("Escape");
    }
    const span = page.locator(".nx-text-layer span", { hasText: "of the noise" }).first();
    await expect(span).toBeAttached({ timeout: 60_000 });
    const point = await span.evaluate((el) => {
      const text = el.textContent ?? "";
      const i = text.indexOf("model of the noise");
      const range = document.createRange();
      range.setStart(el.firstChild!, i);
      range.setEnd(el.firstChild!, i + 5);
      const box = range.getBoundingClientRect();
      return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    });
    await page.mouse.dblclick(point.x, point.y);
    await page.waitForTimeout(250);
    const editor = page.locator(".cm-editor");
    await editor.screenshot({ path: `${OUT}/jw-real-${theme}-now.png` });
    await page.waitForTimeout(1600);
    await editor.screenshot({ path: `${OUT}/jw-real-${theme}-after.png` });
  });
}
