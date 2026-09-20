import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test, expect, openProject } from "../fixtures";
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

/** The Sections drawer, which the bar opens; Files is the default. */
async function sections(tab: Page) {
  await tab.getByTestId("bar-sections").click();
  await expect(tab.getByTestId("drawer")).toHaveAttribute("data-drawer", "sections");
}

test("the rail lists the sections of the file in the editor", async ({ tab }) => {
  await sections(tab);
  const rows = tab.getByTestId("section-row");
  await expect(rows).toHaveCount(3);
  await expect(rows.nth(0)).toContainText("Introduction");
  await expect(rows.nth(1)).toContainText("Results");
  await expect(rows.nth(2)).toContainText("Discussion");
});

test("clicking a section puts the caret in it", async ({ tab }) => {
  await sections(tab);
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
  await sections(tab);
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
  await sections(tab);
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
  await sections(tab);

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

test("the drawer shows one instrument, remembered across a reload", async ({
  tab,
}) => {
  // The rail is an activity bar and one drawer: the writer's reason, on
  // the record in docs/design.md, is that a project is either many short
  // files or one long one with many sections, so the tree or the outline
  // stays open for long stretches and neither may push the other out.
  // Opening one closes the other, and the choice is remembered.
  await expect(tab.locator('[role="tree"]')).toBeVisible();
  await tab.getByTestId("bar-sections").click();
  // Unmounted rather than hidden: the tree owns a type-ahead and a roving
  // tab stop, and both would still answer the keyboard behind a closed
  // drawer.
  await expect(tab.locator('[role="tree"]')).toHaveCount(0);
  await expect(tab.getByTestId("section-row").first()).toBeVisible();
  await expect(tab.getByTestId("bar-sections")).toHaveAttribute("aria-pressed", "true");
  await expect(tab.getByTestId("bar-files")).toHaveAttribute("aria-pressed", "false");

  await tab.reload();
  await tab.locator(".cm-editor").waitFor({ timeout: 20_000 });
  await expect(tab.locator('[role="tree"]')).toHaveCount(0);
  await expect(tab.getByTestId("section-row").first()).toBeVisible();

  await tab.getByTestId("bar-files").click();
  await expect(tab.locator('[role="tree"]')).toBeVisible();
  await expect(tab.getByTestId("section-row")).toHaveCount(0);
});

test("a second press on the drawer's icon folds it, and the bar stays", async ({
  tab,
}) => {
  await expect(tab.getByTestId("drawer")).toBeVisible();
  await tab.getByTestId("bar-files").click();
  await expect(tab.getByTestId("drawer")).toHaveCount(0);
  await expect(tab.getByTestId("activity-bar")).toBeVisible();
  await expect(tab.getByTestId("bar-files")).toHaveAttribute("aria-pressed", "false");
  await tab.getByTestId("bar-sections").click();
  await expect(tab.getByTestId("drawer")).toBeVisible();
  await expect(tab.getByTestId("drawer")).toHaveAttribute("data-drawer", "sections");
  // The keyboard goes with the press: the drawer just opened has focus,
  // so a Tab walks its contents rather than the next icon on the bar.
  const inDrawer = await tab.evaluate(() =>
    Boolean(document.activeElement?.closest("[data-testid=drawer]")),
  );
  expect(inDrawer, "focus stayed on the bar after opening a drawer").toBe(true);
});

test("the bar is reachable on a phone, and its drawer overlays the panes", async ({
  tab,
}) => {
  await tab.setViewportSize({ width: 390, height: 800 });
  const bar = tab.getByTestId("activity-bar");
  await expect(bar).toBeVisible();
  const box = (await bar.boundingBox())!;
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.width).toBe(44);
  await tab.getByTestId("bar-files").click();
  await expect(tab.getByTestId("drawer")).toBeVisible();
  await expect(tab.locator('[role="tree"]')).toBeVisible();
});

test("the sections list is one tab stop, walked with the arrows", async ({
  tab,
}) => {
  await sections(tab);
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
  await sections(tab);

  // A chapter not written yet is the normal state of a skeleton document,
  // and it is also the compile error coming next.
  const row = tab.getByTestId("section-row").filter({ hasText: "missing" });
  await expect(row).toBeDisabled();
  await expect(row).toHaveAttribute(
    "title",
    "chapters/missing.tex is not in this project yet",
  );
});

test("the tree never gets a nested scrollbar, and every drawer stays inside the pane", async ({
  app, project, page,
}) => {
  // Two separate ways the rail came apart under a real project when it
  // was a stack of panels: the panels below Files were pushed out of the
  // pane entirely, and the file list was squeezed to zero height by the
  // panels below it.  With one drawer at a time neither can happen, and
  // this holds it: a project big enough to run out of room, and each
  // drawer in turn inside the pane with the one scroll box it owns.
  mkdirSync(join(project.root, "chapters"), { recursive: true });
  const includes: string[] = [];
  for (let i = 1; i <= 22; i += 1) {
    const name = `chapters/ch${String(i).padStart(2, "0")}`;
    writeFileSync(
      join(project.root, `${name}.tex`),
      `\\section{Chapter ${i}}\n\\subsection{One}\n\\subsection{Two}\n`,
    );
    includes.push(`\\include{${name}}`);
  }
  writeFileSync(
    join(project.root, "main.tex"),
    `\\documentclass{report}\n\\begin{document}\n${includes.join("\n")}\n\\end{document}\n`,
  );

  await page.setViewportSize({ width: 800, height: 700 });
  await page.goto(`${app.base}/?token=${app.token}`);
  await page.getByText("Projects", { exact: false }).first().waitFor();
  await openProject(page, project.root);
  await expect(page.locator(".cm-editor")).toBeVisible({ timeout: 30_000 });

  for (const id of ["files", "sections", "trash", "papers", "git", "submit"]) {
    await page.getByTestId(`bar-${id}`).click();
    const drawer = page.getByTestId("drawer");
    await expect(drawer).toHaveAttribute("data-drawer", id);
    const measured = await drawer.evaluate((pane) => {
      const box = pane.getBoundingClientRect();
      // The scroll boxes inside the drawer: the drawer's own body and
      // nothing nested inside that also scrolls, or the tree would get a
      // scrollbar inside a scrollbar.
      const scrollers = [...pane.querySelectorAll("*")].filter((el) => {
        const style = getComputedStyle(el);
        return /auto|scroll/.test(style.overflowY) && el.scrollHeight > el.clientHeight;
      });
      const nested = scrollers.filter((el) =>
        scrollers.some((other) => other !== el && other.contains(el)),
      );
      const out = [...pane.querySelectorAll("*")].filter((el) => {
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0 && (r.left < box.left - 1 || r.right > box.right + 1);
      });
      return { nested: nested.length, out: out.length, height: box.height };
    });
    expect(measured.nested, `${id}: a scroll box inside a scroll box`).toBe(0);
    expect(measured.out, `${id}: something hangs out of the drawer sideways`).toBe(0);
    expect(measured.height).toBeGreaterThan(300);
  }
});

test("a bar above the source says which section the top of the pane is in", async ({
  project, tab,
}) => {
  /* Driven by the viewport, not the caret: the Sections panel already
     answers the caret's question.  Hidden at the top of the file, before
     the first heading, and on a heading's own line. */
  const lines: string[] = [];
  lines.push("\\section{One}");
  for (let i = 1; i <= 60; i++) lines.push(`Line ${i} of one.`);
  lines.push("\\section{Two}");
  lines.push("\\subsection{Inside two}");
  for (let i = 1; i <= 60; i++) lines.push(`Line ${i} of two.`);
  writeFileSync(join(project.root, "long.tex"), lines.join("\n") + "\n");
  await tab.getByText("long.tex").first().click({ timeout: 15_000 });
  await expect(tab.locator(".cm-content")).toContainText("Line 1 of one.");
  const bar = tab.getByTestId("section-bar");
  // At the top, the heading is on screen and the bar stays out of the way.
  await expect(bar).toHaveCount(0);

  const scroller = tab.locator(".cm-scroller");
  await scroller.evaluate((el) => { el.scrollTop = 20 * 22; });
  await expect(bar).toContainText("One", { timeout: 10_000 });
  await scroller.evaluate((el) => { el.scrollTop = el.scrollHeight; });
  await expect(bar).toContainText("Inside two", { timeout: 10_000 });
  await expect(bar).toContainText("Two");

  // A click goes to the heading, and the bar then hides because the
  // heading's own line is at the top.
  await bar.click();
  await expect(tab.locator(".cm-activeLine")).toContainText("\\subsection{Inside two}", { timeout: 10_000 });

  await scroller.evaluate((el) => { el.scrollTop = 0; });
  await expect(bar).toHaveCount(0, { timeout: 10_000 });
});
