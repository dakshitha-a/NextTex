import { test, openFolders } from "../fixtures";
import type { Page } from "@playwright/test";
import * as fs from "node:fs";
import * as path from "node:path";

/** The surfaces this pass changed, photographed so they can be judged.
 *
 *  Not a check. Like `sweep.spec.ts` it asserts almost nothing: what it is
 *  looking for is whether a thing is ugly, or unreadable, or says the wrong
 *  word, and no assertion finds that.
 */

const OUT = path.join(process.cwd(), "shots", "pass");
const THEMES = ["light", "dark"] as const;

function shot(page: Page, name: string, theme: string) {
  fs.mkdirSync(OUT, { recursive: true });
  return page.screenshot({ path: path.join(OUT, `${name}--${theme}.png`) });
}

/** A 6x6 PNG that is half opaque red and half fully transparent, which is
 *  the case the old viewer got wrong: on --surface-2 in the dark theme the
 *  transparent half was indistinguishable from the pane. */
const ALPHA_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAYAAAAGCAYAAADgzO9IAAAAKklEQVQIW2NkYGD4z8DA" +
  "wMgABXAGNgGwSrgAsgKwSjQFcAG4AFwlXABFAQCK9wX9x2ZgOwAAAABJRU5ErkJggg==",
  "base64",
);

async function dress(page: Page, theme: string) {
  await page.evaluate((t) => window.localStorage.setItem("nexttex.theme", t), theme);
  await page.reload();
  await page.locator(".cm-editor").waitFor({ timeout: 30_000 });
  await page.waitForTimeout(900);
}

test("the surfaces this pass changed", async ({ app, project, tab }) => {
  // A real PDF to put in the tree: the project's own build output, which is
  // exactly the shape of thing a writer drops into figures/.
  let pdf: Buffer | null = null;
  for (let attempt = 0; attempt < 40 && !pdf; attempt++) {
    const answer = await fetch(`${app.base}/api/projects/${project.id}/pdf`, {
      headers: { "x-nexttex-token": app.token },
    });
    if (answer.ok) pdf = Buffer.from(await answer.arrayBuffer());
    else await new Promise((done) => setTimeout(done, 500));
  }
  if (!pdf) throw new Error("the project never produced a PDF to copy");

  fs.mkdirSync(path.join(project.root, "figures"), { recursive: true });
  fs.writeFileSync(path.join(project.root, "figures", "spectrum.pdf"), pdf);
  fs.writeFileSync(path.join(project.root, "figures", "alpha.png"), ALPHA_PNG);

  for (const theme of THEMES) {
    await dress(tab, theme);

    // The tree as it arrives: collapsed, with glyphs.
    await shot(tab, "01-tree-collapsed", theme);

    // Back to the source first: the second time round the loop the active
    // file is still the PNG from the first, and a ground is a thing you
    // judge against text.
    await tab.locator('[data-tab][data-path="main.tex"]').click();
    await tab.waitForTimeout(400);

    // The editor grounds, offered as colours.
    await tab.getByTestId("appearance").first().click();
    await tab.waitForTimeout(300);
    await shot(tab, "02-appearance", theme);
    for (const ground of ["white", "warm", "dark"]) {
      await tab.getByTestId(`editor-theme-${ground}`).click();
      await tab.waitForTimeout(250);
      await shot(tab, `03-ground-${ground}`, theme);
    }
    await tab.getByTestId("editor-theme-match").click();
    await tab.keyboard.press("Escape");
    await tab.waitForTimeout(200);

    // The row menu, grouped, and the confirmation it now carries.
    await tab.getByLabel("Actions for main.tex").click({ force: true });
    await tab.waitForTimeout(250);
    await shot(tab, "04-row-menu", theme);
    await tab.getByText("Delete version history…").click();
    await tab.waitForTimeout(250);
    await shot(tab, "05-purge-confirm", theme);
    await tab.getByTestId("purge-confirm-no").click();

    // A figure kept as PDF, and a figure with an alpha channel.
    await openFolders(tab, "figures/spectrum.pdf");
    await tab.waitForTimeout(300);
    await shot(tab, "06-tree-open", theme);
    await tab.getByRole("tree").getByText("spectrum.pdf").click();
    await tab.waitForTimeout(2500);
    await shot(tab, "07-pdf-from-tree", theme);
    await tab.getByRole("tree").getByText("alpha.png").click();
    await tab.waitForTimeout(1200);
    await shot(tab, "08-image-viewer", theme);
  }
});

test("the screens with no document on them", async ({ app, page }) => {
  // The project list, the sign-in screen and the reconnect screen are all
  // chrome and nothing else -- there is no page being written on any of
  // them -- so they take the furniture whole rather than being the one pale
  // field left in a light theme that went dark everywhere else.
  for (const theme of THEMES) {
    await page.goto(`${app.base}/?token=${app.token}`);
    await page.evaluate(
      (t) => window.localStorage.setItem("nexttex.theme", t),
      theme,
    );
    await page.reload();
    await page.getByText("Projects", { exact: false }).first().waitFor();
    await page.waitForTimeout(700);
    await shot(page, "09-projects", theme);
  }
});
