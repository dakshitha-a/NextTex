import { test, expect } from "../fixtures";
import type { Page } from "@playwright/test";

/** The rail as navigation.
 *
 *  A chapter is long, and a dissertation is longer.  Finding a section used
 *  to mean scrolling the editor or knowing its line number, because the
 *  only outline in the app was the one LaTeX writes into a .toc -- which
 *  exists only after a build and lags the text by a whole compile.  These
 *  specs cover the outline being read from the buffer instead: it is right
 *  while the section is still being typed, and it is what the rail lists.
 */

async function put(page: Page, base: string, token: string, id: string, path: string, text: string) {
  await page.evaluate(
    async ({ base, token, id, path, text }) => {
      await fetch(`${base}/api/projects/${id}/file`, {
        method: "PUT",
        headers: { "content-type": "application/json", "x-nexttex-token": token },
        body: JSON.stringify({ path, text, compile: false, create: true }),
      });
    },
    { base, token, id, path, text },
  );
}

test("the rail lists the sections of the file in the editor", async ({ tab }) => {
  const rows = tab.getByTestId("section-row");
  await expect(rows).toHaveCount(3);
  await expect(rows.nth(0)).toContainText("Introduction");
  await expect(rows.nth(1)).toContainText("Results");
  await expect(rows.nth(2)).toContainText("Discussion");
});

test("clicking a section puts the caret in it", async ({ tab }) => {
  const rows = tab.getByTestId("section-row");
  await rows.filter({ hasText: "Discussion" }).click();
  // The marked row is derived from where the caret is, so it only moves
  // here if the click actually moved the caret.
  await expect(rows.filter({ hasText: "Discussion" })).toHaveAttribute(
    "aria-current",
    "true",
  );
  await expect(rows.filter({ hasText: "Introduction" })).not.toHaveAttribute(
    "aria-current",
    "true",
  );
});

test("the mark follows the caret, and sits nowhere above the first heading", async ({
  tab,
}) => {
  const rows = tab.getByTestId("section-row");
  await rows.filter({ hasText: "Results" }).click();
  await expect(rows.filter({ hasText: "Results" })).toHaveAttribute(
    "aria-current",
    "true",
  );
  // The top of the file is before every section, which is a real place to
  // be rather than a reason to mark the first one.
  await tab.keyboard.press("Control+Home");
  await expect(tab.locator('[data-testid="section-row"][aria-current]')).toHaveCount(0);
});

test("a section typed now is listed now, without a build", async ({ tab }) => {
  await tab.locator(".cm-content").click();
  await tab.keyboard.press("Control+End");
  await tab.keyboard.type("\n\\section{Outlook}\n");
  await expect(
    tab.getByTestId("section-row").filter({ hasText: "Outlook" }),
  ).toBeVisible({ timeout: 10_000 });
});

test("a skeleton document lists the files it includes, and they open", async ({
  tab,
  app,
  project,
}) => {
  await put(tab, app.base, app.token, project.id, "chapters/theory.tex",
    "\\section{Wavefunctions}\n");
  await put(tab, app.base, app.token, project.id, "skeleton.tex",
    "\\documentclass{book}\n\\begin{document}\n\\include{chapters/theory}\n\\end{document}\n");

  await tab.getByTestId("file-search-open").click();
  await tab.getByTestId("file-search").fill("skeleton");
  await tab.locator('[role="tree"] [data-path="skeleton.tex"]').click();
  await tab.getByTestId("file-search").press("Escape");

  const row = tab.getByTestId("section-row").filter({ hasText: "theory" });
  await expect(row).toHaveAttribute("data-kind", "file");
  await row.click();
  await expect(
    tab.locator('[data-tab][data-path="chapters/theory.tex"]'),
  ).toBeVisible({ timeout: 15_000 });
  // And the outline follows into the file that was opened.
  await expect(
    tab.getByTestId("section-row").filter({ hasText: "Wavefunctions" }),
  ).toBeVisible();
});

test("the file list folds away, and stays folded across a reload", async ({
  tab,
}) => {
  await expect(tab.locator('[role="tree"]')).toBeVisible();
  await tab.getByTestId("files-toggle").click();
  // Unmounted rather than hidden: the tree owns a type-ahead and a roving
  // tab stop, and both would still answer the keyboard behind a closed
  // panel.
  await expect(tab.locator('[role="tree"]')).toHaveCount(0);
  // The sections are still there, and now have the room.
  await expect(tab.getByTestId("section-row").first()).toBeVisible();

  await tab.reload();
  await tab.locator(".cm-editor").waitFor({ timeout: 20_000 });
  await expect(tab.locator('[role="tree"]')).toHaveCount(0);

  await tab.getByTestId("files-toggle").click();
  await expect(tab.locator('[role="tree"]')).toBeVisible();
});

test("the sections panel folds too, and says how many it is hiding", async ({
  tab,
}) => {
  await tab.getByTestId("sections-toggle").click();
  await expect(tab.getByTestId("section-row")).toHaveCount(0);
  await expect(tab.getByTestId("sections-panel")).toContainText("3");
});

test("the sections list is one tab stop, walked with the arrows", async ({
  tab,
}) => {
  // Forty headings would otherwise be forty tab stops between the file
  // tree and the trash, which is the same thing the tree itself fixed.
  const rows = tab.getByTestId("section-row");
  await rows.first().focus();
  await expect(rows.nth(1)).toHaveAttribute("tabindex", "-1");
  await tab.keyboard.press("ArrowDown");
  await expect(rows.nth(1)).toBeFocused();
  await tab.keyboard.press("End");
  await expect(rows.nth(2)).toBeFocused();
  await tab.keyboard.press("Enter");
  await expect(rows.nth(2)).toHaveAttribute("aria-current", "true");
});

test("an include for a file that is not there says so instead of doing nothing", async ({
  tab,
  app,
  project,
}) => {
  await put(tab, app.base, app.token, project.id, "skeleton.tex",
    "\\documentclass{book}\n\\begin{document}\n\\include{chapters/missing}\n\\end{document}\n");
  await tab.getByTestId("file-search-open").click();
  await tab.getByTestId("file-search").fill("skeleton");
  await tab.locator('[role="tree"] [data-path="skeleton.tex"]').click();
  await tab.getByTestId("file-search").press("Escape");

  // A chapter not written yet is the normal state of a skeleton document,
  // and it is also the compile error coming next.
  const row = tab.getByTestId("section-row").filter({ hasText: "missing" });
  await expect(row).toBeDisabled();
  await expect(row).toHaveAttribute(
    "title",
    "chapters/missing.tex is not in this project yet",
  );
});
