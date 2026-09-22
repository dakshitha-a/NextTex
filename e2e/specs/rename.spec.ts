import { test, expect } from "../fixtures";
import type { Page } from "@playwright/test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/** Renaming a label everywhere, from the hover on it.
 *
 *  The arithmetic is `nexttex/rename.py` with its own tests; what only a
 *  browser can say is that the tooltip's verbs reach the search panel,
 *  that the panel lists the uses file by file with the commented one
 *  marked, that the rename asks before it writes, and that both files
 *  change and each keeps a version.
 */

async function pointAt(page: Page, contains: string, token: string) {
  return page.evaluate(
    ({ contains, token }) => {
      const line = [...document.querySelectorAll(".cm-line")].find((el) =>
        el.textContent?.includes(contains),
      );
      if (!line) return null;
      const target = line.textContent!.indexOf(token) + Math.floor(token.length / 2);
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
    },
    { contains, token },
  );
}

function seed(root: string) {
  writeFileSync(join(root, "main.tex"), [
    "\\documentclass{article}",
    "\\begin{document}",
    "\\section{A}\\label{sec:a}",
    "See \\ref{sec:a} and \\ref{sec:ab}. % \\ref{sec:a}",
    "\\input{chapters/two}",
    "\\end{document}",
    "",
  ].join("\n"));
  mkdirSync(join(root, "chapters"), { recursive: true });
  writeFileSync(join(root, "chapters", "two.tex"), "Back to \\cref{sec:a,sec:ab}.\n");
}

test("Rename on a reference's tooltip renames the label in every file, asking first", async ({
  app, project, tab,
}) => {
  seed(project.root);
  await tab.reload();
  await expect(tab.locator(".cm-content")).toContainText("See \\ref{sec:a}", { timeout: 45_000 });

  const point = await pointAt(tab, "See \\ref", "sec:a}");
  expect(point).not.toBeNull();
  await tab.mouse.move(point!.x, point!.y);
  await tab.mouse.move(point!.x + 1, point!.y);
  const tip = tab.locator(".nx-link-tooltip");
  await expect(tip).toBeVisible({ timeout: 10_000 });
  await tip.getByTestId("link-rename").click();

  // The search panel lists the uses: four, one in a comment, two files.
  const references = tab.getByTestId("references");
  await expect(references).toBeVisible({ timeout: 10_000 });
  await expect(tab.getByTestId("references-summary")).toHaveText(
    "4 uses of sec:a in 2 files, 1 in a comment", { timeout: 10_000 },
  );
  await expect(tab.getByTestId("search-hit")).toHaveCount(4);

  // The box is filled with the name and selected; a new name and Enter
  // ask before anything is written.
  const box = tab.getByTestId("rename-to");
  await expect(box).toHaveValue("sec:a");
  await expect(box).toBeFocused();
  await tab.keyboard.type("sec:intro");
  await tab.keyboard.press("Enter");
  await expect(references).toContainText("Rename sec:a to sec:intro in 2 files?");
  await tab.getByTestId("rename-confirm").click();

  await expect.poll(() => readFileSync(join(project.root, "main.tex"), "utf-8"), { timeout: 15_000 })
    .toContain("\\label{sec:intro}");
  const main = readFileSync(join(project.root, "main.tex"), "utf-8");
  expect(main).toContain("See \\ref{sec:intro} and \\ref{sec:ab}. % \\ref{sec:a}");
  // The files are saved one after another, so the second is polled too.
  await expect.poll(() => readFileSync(join(project.root, "chapters", "two.tex"), "utf-8"), { timeout: 15_000 })
    .toBe("Back to \\cref{sec:intro,sec:ab}.\n");
  // The editor shows the new name, since the save went through the
  // shared document.
  await expect(tab.locator(".cm-content")).toContainText("See \\ref{sec:intro}");

  // One version per file.
  for (const path of ["main.tex", "chapters/two.tex"]) {
    const versions = await fetch(
      `${app.base}/api/projects/${project.id}/history?path=${encodeURIComponent(path)}`,
      { headers: { "x-nexttex-token": app.token } },
    ).then((r) => r.json());
    expect(versions.versions.length).toBeGreaterThanOrEqual(2);
  }
});

test("F2 on a label opens the rename, and Find references lists without renaming", async ({
  project, tab,
}) => {
  seed(project.root);
  await tab.reload();
  await expect(tab.locator(".cm-content")).toContainText("See \\ref{sec:a}", { timeout: 45_000 });

  const point = await pointAt(tab, "See \\ref", "sec:a}");
  await tab.mouse.move(point!.x, point!.y);
  await tab.mouse.move(point!.x + 1, point!.y);
  await expect(tab.locator(".nx-link-tooltip")).toBeVisible({ timeout: 10_000 });
  await tab.locator(".nx-link-tooltip").getByTestId("link-references").click();
  await expect(tab.getByTestId("references-summary")).toContainText("4 uses of sec:a", { timeout: 10_000 });
  await expect(tab.getByTestId("rename-to")).toHaveCount(0);
  await tab.getByTestId("references-rename").click();
  await expect(tab.getByTestId("rename-to")).toBeVisible();

  // And F2 from the caret on the label itself.
  await tab.locator(".cm-line", { hasText: "\\section{A}" }).click();
  await tab.keyboard.press("End");
  await tab.keyboard.press("ArrowLeft");
  await tab.keyboard.press("ArrowLeft");
  await tab.keyboard.press("F2");
  await expect(tab.getByTestId("rename-to")).toBeFocused({ timeout: 10_000 });
  await expect(tab.getByTestId("rename-to")).toHaveValue("sec:a");
});
