import { test } from "../fixtures";
import type { Locator, Page } from "@playwright/test";
import * as fs from "node:fs";
import * as path from "node:path";

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

const escape = async (tab: Page) => {
  await tab.keyboard.press("Escape");
  await tab.waitForTimeout(150);
};

const SURFACES: Record<string, Surface> = {
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
    open: async (tab) => {
      await tab.getByTestId("appearance").click();
      return tab.getByTestId("settings-sheet");
    },
    close: escape,
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
      await escape(tab);
      await tab.goBack().catch(() => {});
    },
  },
  permission: {
    open: async (tab) => {
      // The fake Claude's "permission" script asks before it runs.
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
