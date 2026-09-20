import { test } from "../fixtures";
import type { Locator, Page } from "@playwright/test";
import * as fs from "node:fs";
import * as path from "node:path";
import { png as pngOf } from "../png";

/** The fidelity pass: one surface at a time, beside the direction page.
 *
 *  Not a check. The visual overhaul was planned on a direction page the
 *  writer agreed to surface by surface, and the rule of that run is that
 *  every surface is rendered from the running app and put beside the
 *  page's drawing of it before its commit. This spec renders the named
 *  surfaces, in both themes, and writes each one's element screenshot
 *  where a person can open it beside the page:
 *
 *    NEXTTEX_FIDELITY=tab-menu,palette \
 *      npx playwright test -c shots.config.ts shots/fidelity.spec.ts
 *
 *  With no list it renders every surface it knows. Each surface is an
 *  entry in SURFACES below: how to open it, and the element to photograph.
 *  A surface that needs a state the fixture cannot make (a collaborator,
 *  a waiting update) says so and is compared by hand.
 */

const OUT = process.env.NEXTTEX_FIDELITY_DIR ?? path.join(process.cwd(), "shots", "fidelity");
const WANTED = (process.env.NEXTTEX_FIDELITY ?? "").split(",").map((s) => s.trim()).filter(Boolean);
const THEMES = ["dark", "light"] as const;

type Surface = {
  /** Opens the surface and returns what to photograph. */
  open: (tab: Page) => Promise<Locator>;
  /** Puts the app back so the next surface starts clean. */
  close?: (tab: Page) => Promise<void>;
};

/** Show a drawer from the bar; a press on the one showing would fold it. */
async function showDrawer(tab: Page, id: string) {
  const drawer = tab.getByTestId("drawer");
  const showing = (await drawer.count()) > 0 && (await drawer.getAttribute("data-drawer")) === id;
  if (!showing) await tab.getByTestId(`bar-${id}`).click();
}

/** The running instance and its project, for a surface that has to
 *  reach the server itself. */
let ctx: { base: string; token: string; id: string; root: string } | null = null;
let scanned = false;

const escape = async (tab: Page) => {
  await tab.keyboard.press("Escape");
  await tab.waitForTimeout(150);
};

/** Hover the character after `needle` on the line holding `lineText`, the
 *  way writing.spec.ts does: measured and moved again until the card is
 *  there, because CodeMirror refuses a hover whose pointer no longer
 *  resolves to the position it measured. */
async function hoverAt(tab: Page, lineText: string, needle: string, card: string): Promise<Locator> {
  const editor = tab.locator(".cm-content");
  await editor.click();
  await tab.keyboard.press("Control+End");
  await tab.keyboard.type(`\n${lineText}`);
  await tab.waitForTimeout(300);
  const measure = () => tab.evaluate(({ lineText, needle }) => {
    const line = [...document.querySelectorAll(".cm-line")].find((el) => el.textContent?.includes(lineText.slice(0, 12)));
    if (!line) return null;
    const target = line.textContent!.indexOf(needle) + 1;
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
  }, { lineText, needle });
  for (let tries = 0; tries < 20; tries += 1) {
    const point = await measure();
    if (point) {
      await tab.mouse.move(point.x - 4, point.y);
      await tab.mouse.move(point.x, point.y);
      await tab.mouse.move(point.x + 1, point.y);
      await tab.waitForTimeout(450);
      if (await tab.locator(card).count()) break;
    }
  }
  await tab.waitForTimeout(600);
  return tab.locator(card).first();
}

const SURFACES: Record<string, Surface> = {
  "math-hover": {
    open: (tab) => hoverAt(tab, "A gap of $E = mc^2$ appears.", "mc^2", ".nx-math-tooltip"),
    close: async (tab) => { await tab.mouse.move(10, 10); await tab.waitForTimeout(300); },
  },
  "cite-hover": {
    open: (tab) => hoverAt(tab, "As shown by \\cite{knuth1984} once.", "knuth", ".nx-link-tooltip"),
    close: async (tab) => { await tab.mouse.move(10, 10); await tab.waitForTimeout(300); },
  },
  "ref-hover": {
    open: (tab) => hoverAt(tab, "See Section~\\ref{sec:results} again.", "sec:res", ".nx-link-tooltip"),
    close: async (tab) => { await tab.mouse.move(10, 10); await tab.waitForTimeout(300); },
  },
  "tab-menu": {
    open: async (tab) => {
      await tab.locator('[data-tab][aria-current="true"], [data-tab].nx-tab-on, [data-tab]').first().click({ button: "right" });
      return tab.getByTestId("tab-menu");
    },
    close: escape,
  },
  "preview-menu": {
    open: async (tab) => {
      await tab.getByTestId("add-preview").click();
      return tab.getByTestId("preview-menu");
    },
    close: escape,
  },
  "preview-tab-menu": {
    open: async (tab) => {
      await tab.locator("[data-preview-tab]").first().click({ button: "right" });
      return tab.getByTestId("preview-tab-menu");
    },
    close: escape,
  },
  "download-menu": {
    open: async (tab) => {
      await tab.getByTestId("open-download").click();
      return tab.getByTestId("download-menu");
    },
    close: escape,
  },
  "prompt-menu": {
    open: async (tab) => {
      const composer = tab.locator("textarea");
      await composer.click();
      await composer.fill("/");
      await tab.waitForTimeout(200);
      return tab.getByTestId("prompt-menu");
    },
    close: async (tab) => {
      // Not Escape: in an empty composer Escape folds the whole column.
      await tab.locator("textarea").fill("");
      await tab.locator(".cm-content").click();
      await tab.waitForTimeout(150);
    },
  },
  "mode-menu": {
    open: async (tab) => {
      await tab.getByTestId("auto-toggle").click();
      return tab.getByTestId("mode-menu");
    },
    close: escape,
  },
  "model-menu": {
    open: async (tab) => {
      await tab.getByTestId("model-open").click();
      return tab.getByTestId("model-menu");
    },
    close: escape,
  },
  palette: {
    open: async (tab) => {
      await tab.keyboard.press("Control+k");
      await tab.getByTestId("palette-input").fill("rebu");
      await tab.waitForTimeout(150);
      return tab.getByTestId("palette");
    },
    close: escape,
  },
  settings: {
    // On How it looks, as the page draws it.
    open: async (tab) => {
      await tab.getByTestId("appearance").click();
      await tab.getByTestId("settings-group-look").click();
      return tab.getByTestId("settings-sheet");
    },
    close: escape,
  },
  "settings-project": {
    open: async (tab) => {
      await tab.getByTestId("appearance").click();
      await tab.getByTestId("settings-group-project").click();
      return tab.getByTestId("settings-sheet");
    },
    close: escape,
  },
  "settings-narrow": {
    // Below 720 px: the groups as a row of segments above the rows.
    open: async (tab) => {
      await tab.setViewportSize({ width: 600, height: 800 });
      await tab.getByTestId("appearance").click();
      await tab.getByTestId("settings-group-write").click();
      return tab.getByTestId("settings-sheet");
    },
    close: async (tab) => {
      await escape(tab);
      await tab.setViewportSize({ width: 1600, height: 1000 });
    },
  },
  share: {
    open: async (tab) => {
      await tab.getByRole("button", { name: /share/i }).first().click();
      return tab.getByTestId("share-panel");
    },
    close: escape,
  },
  access: {
    open: async (tab) => {
      await tab.getByTestId("appearance").click();
      await tab.getByTestId("open-access").click();
      return tab.getByTestId("access-card");
    },
    close: escape,
  },
  "spelling-menu": {
    open: async (tab) => {
      // The checker is off by default; the settings sheet turns it on.
      await tab.getByTestId("appearance").first().click();
      await tab.getByTestId("settings-group-write").click();
      await tab.getByTestId("spelling-on").click();
      await tab.keyboard.press("Escape");
      const editor = tab.locator(".cm-content");
      await editor.click();
      await tab.keyboard.press("Control+End");
      await tab.keyboard.type("\n\nThe spaceing is wrong.\n");
      const word = tab.locator(".nx-misspelled").first();
      await word.waitFor({ timeout: 20_000 });
      await word.click({ button: "right" });
      return tab.getByTestId("spelling-menu");
    },
    close: escape,
  },
  completions: {
    open: async (tab) => {
      const editor = tab.locator(".cm-content");
      await editor.click();
      await tab.keyboard.press("Control+End");
      await tab.keyboard.type("\n\\sec");
      await tab.waitForTimeout(600);
      return tab.locator(".cm-tooltip-autocomplete");
    },
    close: escape,
  },
  selection: {
    open: async (tab) => {
      const editor = tab.locator(".cm-content");
      await editor.click();
      await tab.keyboard.press("Control+Home");
      await tab.keyboard.press("Shift+ArrowDown");
      await tab.keyboard.press("Shift+ArrowDown");
      await tab.waitForTimeout(500);
      return tab.getByTestId("selection-actions");
    },
    close: escape,
  },
  "file-menu": {
    open: async (tab) => {
      await tab.getByLabel("Actions for main.tex").click({ force: true });
      return tab.getByTestId("file-menu");
    },
    close: escape,
  },
  "papers-chooser": {
    open: async (tab) => {
      await tab.getByLabel("Actions for references.bib").click({ force: true });
      await tab.getByRole("button", { name: /Add papers from a folder/ }).click();
      return tab.getByTestId("papers-chooser");
    },
    close: escape,
  },
  upload: {
    open: async (tab) => {
      await tab.locator("#nx-upload").setInputFiles([
        { name: "spectrum.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4\n") },
        { name: "main.tex", mimeType: "text/plain", buffer: Buffer.from("\\section{Again}\n") },
        { name: "notes.md", mimeType: "text/markdown", buffer: Buffer.from("# notes\n") },
      ]);
      return tab.getByTestId("upload-staging");
    },
    close: escape,
  },
  "folder-picker": {
    open: async (tab) => {
      await tab.getByTestId("switch-project").click();
      await tab.getByTestId("ways-open").click().catch(() => {});
      await tab.getByTestId("browse-folder").click();
      return tab.getByTestId("folder-picker");
    },
    close: async (tab) => {
      // Back into the project from the list: leaving it is not a history
      // entry, so there is nothing to go back to.
      await escape(tab);
      await tab.getByTestId("project-row").first().click();
      await tab.locator(".cm-editor").waitFor({ timeout: 30_000 });
      await tab.waitForTimeout(500);
    },
  },
  permission: {
    open: async (tab) => {
      // The fake Claude's "permission" script asks before it runs.
      // The folder picker before this went to the projects screen and
      // back, and the project takes a moment to be a workspace again.
      await tab.locator(".cm-editor").waitFor({ timeout: 30_000 });
      const composer = tab.locator("textarea");
      await composer.click();
      await composer.fill("#script:permission\nRun something.");
      await tab.getByRole("button", { name: "Send" }).click();
      const card = tab.getByTestId("permission-card");
      await card.waitFor({ timeout: 20_000 });
      await tab.waitForTimeout(500);
      return card;
    },
    close: async (tab) => {
      await tab.getByTestId("deny").click().catch(() => {});
      await tab.waitForTimeout(300);
    },
  },
  diagnostics: {
    // A bad command and a missing citation, so the tray has an error, a
    // "Start here" card and a warning, as the page draws it.
    open: async (tab) => {
      // Inside the document: after the first line, which is a comment.
      // Past \end{document} LaTeX reads nothing, and no error would come.
      const editor = tab.locator(".cm-content");
      await editor.click();
      await tab.keyboard.press("Control+Home");
      await tab.keyboard.press("End");
      await tab.keyboard.type("\n\\badcommand{x} and \\cite{nothere}\n");
      await tab.getByTestId("status").waitFor();
      await tab.waitForFunction(() => /error|warn/.test(document.querySelector("[data-testid=status]")?.getAttribute("data-state") ?? ""), null, { timeout: 60_000 });
      await tab.getByTestId("status").click();
      const tray = tab.getByTestId("diagnostics");
      await tray.waitFor();
      await tray.getByRole("button", { name: /badcommand|Undefined/i }).first().click().catch(() => undefined);
      await tab.waitForTimeout(300);
      return tray;
    },
    close: async (tab) => {
      await tab.getByTestId("diagnostics-header").getByRole("button", { name: "Close" }).click().catch(() => undefined);
      const editor = tab.locator(".cm-content");
      await editor.click();
      await tab.keyboard.press("Control+Home");
      await tab.keyboard.press("ArrowDown");
      await tab.keyboard.press("Shift+End");
      await tab.keyboard.press("Backspace");
      await tab.keyboard.press("Backspace");
    },
  },
  history: {
    // A typed change so there are two versions, the panel from the row's
    // menu, and a version chosen so the banner shows.
    open: async (tab) => {
      const editor = tab.locator(".cm-content");
      await editor.click();
      await tab.keyboard.press("Control+Home");
      await tab.keyboard.press("End");
      await tab.keyboard.type(" Revised.");
      await tab.waitForTimeout(2500);
      await tab.getByLabel("Actions for main.tex").click({ force: true });
      await tab.getByRole("tree").getByRole("button", { name: "History", exact: true }).click();
      const panel = tab.getByTestId("history-panel");
      await panel.waitFor();
      await tab.getByTestId("version").last().waitFor({ timeout: 20_000 });
      await tab.getByTestId("version").last().click();
      await tab.getByTestId("viewing-banner").waitFor();
      await tab.getByTestId("version").first().hover();
      await tab.waitForTimeout(300);
      return tab.locator(".nx-shell");
    },
    close: async (tab) => {
      await tab.getByRole("button", { name: "Back to now" }).click().catch(() => undefined);
      await tab.getByLabel("Close the history").click().catch(() => undefined);
    },
  },
  /* The drawers, one surface each: the drawer's own element, so the
     heading row and the body are in the picture.  Sections and Search
     are full in the dark run and empty in the light one, as the page
     draws them; the harness cannot empty a project between themes, so
     the light Sections render is compared for its chrome only. */
  "drawer-files-card": {
    // The Files drawer with the card beside an image's row, as the page
    // draws it: a 1200 by 800 plot named as the page names it.
    open: async (tab) => {
      if (ctx) {
        fs.mkdirSync(path.join(ctx.root, "figures"), { recursive: true });
        fs.writeFileSync(path.join(ctx.root, "figures", "decay-fit.png"), pngOf(1200, 800));
      }
      await showDrawer(tab, "files");
      const folder = tab.locator('[role="tree"] [data-path="figures"]');
      await folder.waitFor();
      if ((await folder.getAttribute("aria-expanded")) !== "true") await folder.click();
      const row = tab.locator('[role="tree"] [data-path="figures/decay-fit.png"]');
      await row.waitFor({ timeout: 10_000 });
      await row.hover();
      await tab.getByTestId("file-card").locator("img").waitFor({ timeout: 10_000 });
      return tab.locator(".nx-shell");
    },
    close: async (tab) => {
      await tab.locator('[role="tree"] [data-path="main.tex"]').hover();
    },
  },
  "drawer-sections": {
    open: async (tab) => {
      await showDrawer(tab, "sections");
      await tab.getByTestId("section-row").first().waitFor();
      return tab.getByTestId("drawer");
    },
    close: async (tab) => { await showDrawer(tab, "files"); },
  },
  "drawer-search": {
    open: async (tab) => {
      await showDrawer(tab, "search");
      await tab.getByTestId("project-search").fill("section");
      await tab.getByTestId("search-hit").first().waitFor({ timeout: 10_000 });
      await tab.getByTestId("search-hit").nth(1).hover();
      return tab.getByTestId("drawer");
    },
    close: async (tab) => {
      await tab.getByTestId("project-search").fill("");
      await showDrawer(tab, "files");
    },
  },
  "drawer-trash": {
    open: async (tab) => {
      await showDrawer(tab, "files");
      await tab.getByLabel("Actions for appendix.tex").click({ force: true });
      await tab.getByRole("tree").getByRole("button", { name: "Move to trash", exact: true }).click();
      await showDrawer(tab, "trash");
      await tab.getByTestId("trash-entry").first().waitFor({ timeout: 10_000 });
      await tab.getByTestId("trash-entry").first().hover();
      return tab.getByTestId("drawer");
    },
    close: async (tab) => {
      await tab.getByTestId("trash-entry").first().hover();
      await tab.getByRole("button", { name: "Restore" }).first().click();
      await showDrawer(tab, "files");
    },
  },
  "drawer-papers-empty": {
    // Before anything has been searched or read: the field and the one
    // sentence with its action, as the page draws the light drawer.
    // Rendered in a run of its own, since drawer-papers reads a folder
    // and the outcome stays for the rest of the fixture.
    open: async (tab) => {
      // The template's bibliography holds an entry; emptied, so the
      // drawer's sentence is true and it is shown.
      if (ctx) fs.writeFileSync(path.join(ctx.root, "references.bib"), "");
      await showDrawer(tab, "papers");
      await tab.getByTestId("papers-panel").getByRole("button", { name: "Read a folder of PDFs" }).waitFor();
      return tab.getByTestId("drawer");
    },
    close: async (tab) => { await showDrawer(tab, "files"); },
  },
  "drawer-papers": {
    // The search half stubbed, since the harness never reaches a
    // publisher: three rows, the second already added, the first under
    // the pointer with its card; the folder half read for real from two
    // PDFs no DOI can be found in, once, the first time this opens.
    open: async (tab) => {
      if (!scanned && ctx) {
        scanned = true;
        fs.mkdirSync(path.join(ctx.root, "figures"), { recursive: true });
        fs.writeFileSync(path.join(ctx.root, "figures", "scan-2019-03.pdf"), "%PDF-1.4\n% scan");
        fs.writeFileSync(path.join(ctx.root, "figures", "preprint.pdf"), "%PDF-1.4\n% preprint");
        await fetch(`${ctx.base}/api/projects/${ctx.id}/library/scan`, {
          method: "POST",
          headers: { "content-type": "application/json", "x-nexttex-token": ctx.token },
          body: JSON.stringify({ path: path.join(ctx.root, "figures") }),
        });
      }
      await tab.route("**/library/search?*", (route) => route.fulfill({
        status: 200, contentType: "application/json",
        body: JSON.stringify({ source: "crossref", results: [
          { doi: "10.1146/annurev-physchem-052516-050721", title: "Dynamics at conical intersections",
            first: "Schuurman", authors: 2, year: "2018", journal: "Annu. Rev. Phys. Chem.",
            names: ["Michael S. Schuurman", "Albert Stolow"],
            abstract: "Conical intersections are the dominant mechanism for nonadiabatic transitions between electronic states in polyatomic molecules. We review the time-resolved spectroscopies and the ab initio dynamics that together reveal how a wavepacket passes through the seam, and what the passage leaves in the product distribution." },
          { doi: "10.1021/ar970149x", title: "Conical intersections: diabolical and often misunderstood",
            first: "Yarkony", authors: 1, year: "1998", journal: "Acc. Chem. Res.", names: ["David R. Yarkony"], abstract: "" },
          { doi: "10.1063/1.3700152", title: "Ultrafast dynamics through a conical intersection in pyrazine",
            first: "Suzuki", authors: 1, year: "2012", journal: "J. Chem. Phys.", names: ["Toshinori Suzuki"], abstract: "" },
        ] }),
      }));
      await tab.route("**/library/add", (route) => route.fulfill({
        status: 200, contentType: "application/json",
        body: JSON.stringify({ added: true, key: "yarkony1998", title: "Conical intersections", author: "Yarkony", year: "1998" }),
      }));
      await showDrawer(tab, "papers");
      const panel = tab.getByTestId("papers-panel");
      // Hidden until the row is hovered, so waited for as attached.
      await panel.locator("button", { hasText: "Give a DOI" }).nth(1).waitFor({ state: "attached", timeout: 30_000 });
      if ((await panel.getByTestId("papers-result").count()) === 0) {
        await panel.getByTestId("papers-search").fill("conical intersection dynamics");
        await tab.keyboard.press("Enter");
        await panel.getByTestId("papers-result").nth(2).waitFor();
        await panel.getByTestId("papers-result").nth(1).getByTestId("papers-result-add").click();
        await panel.getByTestId("papers-result-added").waitFor();
      }
      await panel.getByTestId("papers-result").first().hover();
      await tab.getByTestId("papers-card").waitFor({ timeout: 5_000 });
      return tab.getByTestId("drawer");
    },
    close: async (tab) => {
      await tab.unroute("**/library/search?*");
      await tab.unroute("**/library/add");
      await showDrawer(tab, "files");
    },
  },
  "drawer-submit": {
    open: async (tab) => {
      await showDrawer(tab, "submit");
      await tab.getByTestId("submit-check").click();
      await tab.getByTestId("submit-row").first().waitFor({ timeout: 60_000 });
      await tab.getByTestId("submit-row").first().click();
      await tab.waitForTimeout(300);
      return tab.getByTestId("drawer");
    },
    close: async (tab) => { await showDrawer(tab, "files"); },
  },
  workspace: {
    // The shell at rest, at the page's width: the rail, the two panes and
    // the column, with nothing open.
    open: async (tab) => tab.locator(".nx-shell"),
  },
  strips: {
    // The three folded strips at once: Source, Preview and Claude, as the
    // page draws them side by side.  The shell is the photograph, so the
    // strips are seen against the row they sit in.
    open: async (tab) => {
      // The folds are remembered across the reload between themes, so a
      // pane may already be a strip when this runs.
      const fold = async (label: string, strip: string) => {
        if (await tab.getByTestId(strip).count()) return;
        await tab.getByRole("button", { name: label }).click();
        await tab.getByTestId(strip).waitFor();
      };
      await fold("Fold this panel away", "collapsed-claude");
      await fold("Fold the source away", "collapsed-source");
      await fold("Fold the preview away", "collapsed-preview");
      await tab.waitForTimeout(200);
      return tab.locator(".nx-shell");
    },
    close: async (tab) => {
      // Unfolded by their strips rather than by a reload: the folds are
      // remembered, so a reload would come back folded.
      for (const strip of ["collapsed-source", "collapsed-preview", "collapsed-claude"]) {
        await tab.getByTestId(strip).click().catch(() => undefined);
        await tab.waitForTimeout(150);
      }
      await tab.locator(".cm-editor").waitFor({ timeout: 30_000 });
    },
  },
  pill: {
    // Only on the parked overlay, so the window narrows first.
    open: async (tab) => {
      await tab.setViewportSize({ width: 1200, height: 1000 });
      await tab.waitForTimeout(300);
      return tab.getByTestId("agent-button-claude");
    },
    close: async (tab) => {
      await tab.setViewportSize({ width: 1600, height: 1000 });
      await tab.waitForTimeout(300);
    },
  },
  notices: {
    open: async (tab) => {
      await tab.evaluate(() => {
        // The store is on the window in development builds; when it is not,
        // the notice cannot be forced and this surface is compared by hand.
        const w = window as unknown as { __nexttex?: { set: (s: object) => void } };
        w.__nexttex?.set({ error: "Could not download the PDF: the build has not finished." });
      });
      await tab.waitForTimeout(200);
      return tab.getByTestId("notices");
    },
  },
};

async function dress(tab: Page, theme: string) {
  await tab.setViewportSize({ width: 1600, height: 1000 });
  await tab.evaluate((t) => window.localStorage.setItem("nexttex.theme", t), theme);
  await tab.reload();
  await tab.locator(".cm-editor").waitFor({ timeout: 30_000 });
  await tab.waitForTimeout(800);
}

test("the named surfaces, in both themes, beside the page", async ({ app, project, tab }) => {
  test.setTimeout(900_000);
  fs.mkdirSync(OUT, { recursive: true });
  // A short leash per action: a surface the fixture cannot open is written
  // down as failed and the run goes on to the next one.
  tab.setDefaultTimeout(6_000);
  // A second document, so the preview strip is a strip with a "+" and the
  // download menu has two rows, as on the page.
  for (const name of ["supplement.tex", "appendix.tex"]) {
    fs.writeFileSync(
      path.join(project.root, name),
      "\\documentclass{article}\n\\begin{document}\nSupplementary information.\n\\end{document}\n",
    );
  }
  // The second is previewed, so the strip has two tabs; the third is not,
  // so the "+" has something to offer.

  await fetch(`${app.base}/api/projects/${project.id}/previews`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-nexttex-token": app.token },
    body: JSON.stringify({ path: "supplement.tex" }),
  });
  ctx = { base: app.base, token: app.token, id: project.id, root: project.root };
  const names = WANTED.length ? WANTED : Object.keys(SURFACES);
  for (const theme of THEMES) {
    await dress(tab, theme);
    for (const name of names) {
      const surface = SURFACES[name];
      if (!surface) throw new Error(`no surface called ${name}`);
      try {
        const target = await surface.open(tab);
        await target.waitFor({ timeout: 5_000 });
        await tab.waitForTimeout(250);
        await target.screenshot({ path: path.join(OUT, `${name}--${theme}.png`) });
      } catch (error) {
        fs.writeFileSync(path.join(OUT, `${name}--${theme}.failed.txt`), String(error));
      }
      await surface.close?.(tab);
      await tab.waitForTimeout(150);
    }
  }
});
