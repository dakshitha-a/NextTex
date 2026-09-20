import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Locator, Page } from "@playwright/test";
import { test, expect, openFolders, openProject } from "../fixtures";
import { measure, tooFaint } from "../contrast";
import { png } from "../png";

/** Every menu, popup and floating panel, read.
 *
 *  The writer asked for an audit of text visibility in every menu, after
 *  typing into the editor's find box and seeing nothing.  An audit that
 *  is done once is a report; this one is a spec, so the next surface
 *  that draws ink the colour of its ground fails a check rather than
 *  waiting to be noticed.
 *
 *  Each surface is opened the way a person opens it and measured with
 *  `e2e/contrast.ts`, which composites the colour actually painted behind
 *  each run of text.  The floor is 4.5:1, WCAG's for ordinary text, and
 *  the app's own tightest pair (`--ink-3` on `--surface-3`) clears it at
 *  4.55.  Three pairings, because the app has two palettes that can be
 *  mixed: the shell's theme and the editor page's, and a surface that
 *  lives inside the editor host takes the page's palette while one that
 *  floats over it takes the shell's.  The find box failed in exactly one
 *  of them.  There were four while a light shell could hold a dark page;
 *  that ground went with the overhaul.
 *
 *  A surface that cannot be reached in a run is reported rather than
 *  skipped: a missing menu is a broken recipe, and a recipe that has
 *  silently stopped opening anything measures nothing and passes.
 */

const FLOOR = 4.5;

type Pairing = {
  name: string;
  shell: "light" | "dark";
  /** The editor page's own palette, or `match` for the shell's. */
  page: "match" | "white";
};

const PAIRINGS: Pairing[] = [
  { name: "dark shell", shell: "dark", page: "match" },
  { name: "light shell", shell: "light", page: "match" },
  { name: "dark shell, white page", shell: "dark", page: "white" },
];

type Surface = {
  name: string;
  /** Open it and hand back what to measure. */
  open: (tab: Page) => Promise<Locator>;
  /** Put it away.  Escape, unless the surface needs something else. */
  close?: (tab: Page) => Promise<void>;
};

const esc = async (tab: Page) => {
  await tab.keyboard.press("Escape");
};

/** Open a row's `⋯` menu and pick an item from it. */
async function rowMenu(tab: Page, path: string, item?: string): Promise<Locator> {
  const menu = tab.getByTestId("file-menu");
  // A menu left open by the surface before, on this row or another, would
  // be toggled shut by the click that means to open this one.
  if (await menu.isVisible()) {
    await tab.keyboard.press("Escape");
    await expect(menu).toHaveCount(0);
  }
  const row = tab.locator(`[role="tree"] [data-path="${path}"]`);
  await row.hover();
  await row.getByLabel(`Actions for ${path.split("/").pop()}`).click();
  await menu.waitFor();
  if (item) await menu.getByRole("button", { name: item, exact: true }).click();
  return menu;
}

const SURFACES: Surface[] = [
  {
    name: "the app at rest",
    open: async (tab) => tab.locator("body"),
    close: async () => undefined,
  },
  {
    name: "the source tab menu",
    open: async (tab) => {
      // From the tree, since the strip overflows and the tab may be in
      // the hidden list; the tab in front is always drawn.
      await tab.locator('[role="tree"] [data-path="main.tex"]').click();
      const front = tab.locator('[data-tab][data-path="main.tex"]');
      await expect(front).toBeVisible();
      await front.click({ button: "right" });
      return tab.getByTestId("tab-menu");
    },
  },
  {
    name: "the preview tab menu",
    open: async (tab) => {
      await tab.getByTestId("preview-tab-main.tex").click({ button: "right" });
      return tab.getByTestId("preview-tab-menu");
    },
  },
  {
    name: "the hidden tabs menu",
    open: async (tab) => {
      const hidden = tab.getByTestId("tabs-hidden");
      await expect(hidden).toBeVisible({ timeout: 10_000 });
      await hidden.click();
      return tab.getByTestId("tabs-hidden-menu");
    },
  },
  {
    name: "the preview strip's + menu",
    open: async (tab) => {
      await tab.getByTestId("add-preview").click();
      return tab.getByTestId("preview-menu");
    },
  },
  {
    name: "the download menu",
    open: async (tab) => {
      await tab.getByTestId("open-download").click();
      return tab.getByTestId("download-menu");
    },
  },
  {
    name: "the file row menu",
    open: async (tab) => rowMenu(tab, "main.tex"),
  },
  {
    name: "the file row menu, asking about deleting history",
    open: async (tab) => {
      await rowMenu(tab, "main.tex", "Delete version history…");
      await tab.getByTestId("purge-confirm").waitFor();
      return tab.getByTestId("file-menu");
    },
  },
  {
    name: "Move to…",
    open: async (tab) => {
      await rowMenu(tab, "main.tex", "Move to…");
      return tab.getByTestId("move-to");
    },
  },
  {
    name: "the papers chooser",
    open: async (tab) => {
      await rowMenu(tab, "references.bib", "Add papers from a folder…");
      return tab.getByTestId("papers-chooser");
    },
  },
  {
    name: "the upload card with a name already taken",
    open: async (tab) => {
      await rowMenu(tab, "figures/plot.png", "Upload here");
      await tab.locator("#nx-upload").setInputFiles({
        name: "plot.png", mimeType: "image/png", buffer: png(40, 30),
      });
      const card = tab.getByTestId("upload-staging");
      await expect(card).toContainText("already there", { timeout: 10_000 });
      return card;
    },
  },
  {
    name: "the History panel",
    open: async (tab) => {
      await rowMenu(tab, "main.tex", "History");
      const panel = tab.getByTestId("history-panel");
      await expect(tab.getByTestId("version").first()).toBeVisible({ timeout: 15_000 });
      return panel;
    },
    close: async (tab) => {
      await tab.getByLabel("Close the history").click();
    },
  },
  {
    name: "the rename box",
    open: async (tab) => {
      await rowMenu(tab, "main.tex", "Rename");
      const box = tab.locator('[role="tree"] input');
      await box.waitFor();
      return tab.locator('[role="tree"]');
    },
  },
  {
    name: "the new file box",
    open: async (tab) => {
      await tab.getByTestId("new-file").click();
      await tab.keyboard.type("draft");
      return tab.locator('[role="tree"]');
    },
  },
  {
    name: "the file search",
    open: async (tab) => {
      await tab.getByTestId("file-search-open").click();
      await tab.getByTestId("file-search").fill("main");
      return tab.locator('[role="tree"]').locator("xpath=..");
    },
    close: async (tab) => {
      await tab.getByTestId("file-search").fill("");
      await esc(tab);
    },
  },
  {
    name: "the project search",
    open: async (tab) => {
      const field = tab.getByTestId("project-search");
      if (!(await field.isVisible())) await tab.getByTestId("search-toggle").click();
      await field.fill("Introduction");
      await expect(tab.getByTestId("search-hit").first()).toBeVisible({ timeout: 10_000 });
      return tab.getByTestId("search-panel");
    },
    close: async (tab) => {
      await tab.getByTestId("project-search").fill("");
    },
  },
  {
    name: "the editor's find and replace",
    open: async (tab) => {
      await tab.locator(".cm-content").click();
      await tab.keyboard.press("Control+f");
      const panel = tab.locator(".cm-panel.cm-search");
      await panel.waitFor();
      await tab.keyboard.type("Introduction");
      await tab.locator(".cm-panel.cm-search input[name=replace]").fill("Overture");
      return panel;
    },
  },
  {
    name: "the completion list",
    open: async (tab) => {
      await tab.locator(".cm-content").click();
      await tab.keyboard.press("Control+End");
      await tab.keyboard.type("\n\\secti");
      const list = tab.locator(".cm-tooltip-autocomplete");
      await expect(list).toBeVisible({ timeout: 10_000 });
      return list;
    },
    close: async (tab) => {
      await esc(tab);
      // Take the half-typed command back out, so the document is as it was
      // for the surfaces after this one.
      for (let i = 0; i < 7; i += 1) await tab.keyboard.press("Backspace");
    },
  },
  {
    name: "the selection verbs",
    open: async (tab) => {
      await tab.locator(".cm-content").click();
      await tab.keyboard.press("Control+Home");
      for (let i = 0; i < 6; i += 1) await tab.keyboard.press("ArrowDown");
      await tab.keyboard.press("Home");
      await tab.keyboard.press("Shift+End");
      const row = tab.getByTestId("selection-actions");
      await expect(row).toBeVisible({ timeout: 10_000 });
      return row;
    },
  },
  {
    name: "the spelling menu",
    open: async (tab) => {
      const word = tab.locator(".nx-misspelled").first();
      await expect(word).toBeVisible({ timeout: 20_000 });
      await word.click({ button: "right" });
      return tab.getByTestId("spelling-menu");
    },
  },
  {
    name: "the page's find bar",
    open: async (tab) => {
      await tab.locator(".nx-page").first().click();
      await tab.keyboard.press("Control+f");
      const bar = tab.getByTestId("pdf-find-bar");
      await bar.waitFor();
      await tab.keyboard.type("Intro");
      return bar;
    },
  },
  {
    name: "the status strip under the source",
    open: async (tab) => tab.getByTestId("status-strip"),
  },
  {
    name: "the page's footer, with the page number being typed",
    open: async (tab) => {
      const number = tab.getByTestId("page-number");
      await number.click();
      await number.fill("1");
      return tab.getByTestId("preview-footer");
    },
  },
  {
    name: "the model menu",
    open: async (tab) => {
      await tab.getByTestId("model-open").click();
      return tab.getByTestId("model-menu");
    },
  },
  {
    name: "the mode menu",
    open: async (tab) => {
      await tab.getByTestId("auto-toggle").click();
      return tab.getByTestId("mode-menu");
    },
  },
  {
    name: "the prompt menu",
    open: async (tab) => {
      const composer = tab.locator("textarea");
      await composer.click();
      await composer.pressSequentially("/rev");
      const menu = tab.getByTestId("prompt-menu");
      await expect(menu).toBeVisible({ timeout: 10_000 });
      return menu;
    },
    close: async (tab) => {
      await tab.locator("textarea").fill("");
      await esc(tab);
    },
  },
  {
    name: "the settings sheet",
    open: async (tab) => {
      await tab.getByTestId("appearance").first().click();
      return tab.getByRole("dialog", { name: "Settings" });
    },
  },
  {
    name: "the Markdown preview",
    open: async (tab) => {
      await tab.locator('[role="tree"] [data-path="notes.md"]').click();
      const view = tab.getByTestId("markdown-view");
      await expect(view.getByRole("heading", { level: 1 })).toBeVisible({ timeout: 10_000 });
      return view;
    },
    close: async (tab) => {
      await tab.locator('[role="tree"] [data-path="main.tex"]').click();
    },
  },
  {
    name: "the submission panel",
    open: async (tab) => {
      const panel = tab.getByTestId("submit-panel");
      await panel.getByRole("button", { name: /Before you submit/ }).click();
      await panel.getByTestId("submit-check").click();
      // Either the report's headline or the "build first" line: both are
      // text this panel draws, and which one arrives depends on whether
      // the open's build has finished.
      await expect(
        panel.getByTestId("submit-headline").or(panel.getByTestId("submit-said")),
      ).toBeVisible({ timeout: 30_000 });
      return panel.getByTestId("submit-body");
    },
    close: async (tab) => {
      await tab.getByTestId("submit-panel").getByRole("button", { name: /Before you submit/ }).click();
    },
  },
  {
    name: "the command palette",
    open: async (tab) => {
      await tab.locator("body").click({ position: { x: 4, y: 4 } });
      await tab.keyboard.press("Control+k");
      const palette = tab.getByTestId("palette");
      await expect(palette).toBeVisible({ timeout: 10_000 });
      // Typed, so a setting row with its "current" mark and a file row
      // are on screen beside the actions.
      await tab.keyboard.type("e");
      await expect(palette.getByTestId("palette-row").first()).toBeVisible();
      return palette;
    },
  },
  {
    name: "the share panel",
    open: async (tab) => {
      await tab.getByTestId("open-share").click();
      return tab.getByTestId("share-panel");
    },
    close: async (tab) => {
      await tab.getByTestId("share-close").click();
    },
  },
];

/** Put the project in the state the surfaces expect: a figure to collide
 *  with, a second document for the `+` menu, a misspelling for the
 *  spelling menu, and enough files to overflow the tab strip. */
async function prepare(app: any, project: any, page: Page, pairing: Pairing) {
  mkdirSync(join(project.root, "figures"), { recursive: true });
  writeFileSync(join(project.root, "figures", "plot.png"), png(40, 30));
  writeFileSync(
    join(project.root, "esi.tex"),
    "\\documentclass{article}\n\\begin{document}\nSupplementary.\n\\end{document}\n",
  );
  for (let i = 0; i < 8; i += 1) {
    writeFileSync(join(project.root, `part${i}.tex`), `Part ${i}, recieved.\n`);
  }
  writeFileSync(
    join(project.root, "notes.md"),
    "# Notes\n\nSome *prose*, a `command`, and **weight**.\n\n- one\n- two\n\n> quoted\n\n```tex\n\\section{x}\n```\n",
  );
  await page.emulateMedia({ colorScheme: pairing.shell, reducedMotion: "reduce" });
  await page.goto(`${app.base}/?token=${app.token}`);
  await page.getByText("Projects", { exact: false }).first().waitFor();
  await openProject(page, project.root);
  await expect(page.locator(".cm-editor")).toBeVisible({ timeout: 30_000 });

  // The shell's theme and the page's palette, from the settings sheet, so
  // the pairing is the one a writer can make rather than one only a test
  // can.  Spelling on, for the menu that needs a misspelling.
  await page.getByTestId("appearance").first().click();
  await page.getByTestId(`theme-${pairing.shell}`).click();
  await page.getByTestId(`editor-theme-${pairing.page}`).click();
  await page.getByTestId("spelling-on").click();
  await page.keyboard.press("Escape");

  // A strip that overflows, with main.tex back in front at the end.
  for (let i = 0; i < 8; i += 1) {
    await page.locator(`[role="tree"] [data-path="part${i}.tex"]`).click();
    await expect(page.locator(`[data-tab][data-path="part${i}.tex"]`)).toBeVisible();
  }
  await page.locator('[role="tree"] [data-path="main.tex"]').click();
  await expect(page.locator('[data-tab][data-path="main.tex"] button[aria-current="true"]')).toBeVisible();
  // A misspelling in the file in front, typed rather than seeded so the
  // checker has seen it arrive, and after the section heading, where the
  // text is prose: nothing after \end{document} is checked.
  await page.locator(".cm-content").click();
  await page.keyboard.press("Control+Home");
  for (let i = 0; i < 40; i += 1) await page.keyboard.press("ArrowDown");
  await page.keyboard.press("End");
  await page.keyboard.type("\nThe results are recieved today.");
  await expect(page.locator(".nx-misspelled").first()).toBeVisible({ timeout: 20_000 });
  await openFolders(page, "figures/plot.png");
  await page.locator(".nx-page").first().waitFor({ timeout: 60_000 });
}

for (const pairing of PAIRINGS) {
  test(`every menu and popup reads in the ${pairing.name}`, async ({ app, project, page }) => {
    test.setTimeout(180_000);
    await prepare(app, project, page, pairing);

    const problems: string[] = [];
    for (const surface of SURFACES) {
      let target: Locator;
      const started = Date.now();
      try {
        target = await surface.open(page);
        await target.first().waitFor({ state: "visible", timeout: 10_000 });
      } catch (error: any) {
        problems.push(`${surface.name}: could not be opened (${String(error.message).split("\n")[0]})`);
        await esc(page);
        continue;
      }
      const readings = await measure(target.first());
      if (!readings.length) problems.push(`${surface.name}: nothing to measure`);
      const faint = tooFaint(readings, FLOOR);
      if (faint) problems.push(`${surface.name}:\n${faint}`);
      await (surface.close ?? esc)(page);
      await page.waitForTimeout(80);
      // One line per surface on the way through, so a run that stalls
      // says where, and a run that passes says what it measured.
      console.log(`${pairing.name}: ${surface.name}, ${readings.length} runs of text, ${Date.now() - started} ms`);
    }
    expect(problems.join("\n\n")).toBe("");
  });
}
