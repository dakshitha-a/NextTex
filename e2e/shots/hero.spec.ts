import { test as base, expect, openProject } from "../fixtures";
import type { Page } from "@playwright/test";
import { cpSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ROOT } from "../server";

/** The README's screenshots, captured against a real instance rather than
 *  mocked up.
 *
 *  Outside `specs/` on purpose, so no tier picks it up: it writes files
 *  into the repository, and it is two more browsers competing for the
 *  machine during a run that already starts a server and a LaTeX build per
 *  spec.  Run it by hand when the interface changes:
 *
 *      cd e2e && node_modules/.bin/playwright test --config shots.config.ts
 */

/** The harness's project is named after its folder, `p0-1789929422349`,
 *  which no README should carry.  This one is seeded by hand with a
 *  `nexttex.toml` naming it before it is registered, since the name is
 *  read as the project is added, and opened the way the `tab` fixture
 *  opens its own. */
const test = base.extend<{ tab: Page }>({
  tab: async ({ app, page }, use) => {
    const root = join(app.projects, "nonadiabatic-dynamics-review");
    cpSync(join(ROOT, "nexttex", "templates", "basic"), root, { recursive: true });
    mkdirSync(join(root, "figures"), { recursive: true });
    writeFileSync(join(root, "nexttex.toml"), '[project]\nname = "Nonadiabatic dynamics review"\nbuild_dir = "build"\n');
    const added = await fetch(`${app.base}/api/projects`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-nexttex-token": app.token },
      body: JSON.stringify({ path: root }),
    });
    if (!added.ok) throw new Error(`could not register the project: ${added.status}`);
    await page.goto(`${app.base}/?token=${app.token}`);
    await page.getByText("Projects", { exact: false }).first().waitFor();
    await openProject(page, root);
    await use(page);
  },
});

async function stage(tab: Page) {
  await expect(tab.locator(".cm-editor")).toBeVisible({ timeout: 30_000 });
  // A conversation with something in it: an empty transcript makes the
  // agent column look like an empty box rather than the point of the app.
  const composer = tab.locator("textarea");
  await composer.fill("#script:edit\nTighten the abstract's first sentence.");
  await tab.getByRole("button", { name: "Send" }).click();
  await tab.waitForTimeout(2500);
  await expect(tab.locator("canvas").first()).toBeVisible({ timeout: 45_000 });
  // At rest: the edit above starts a second build, and a shot taken while
  // it runs shows "Compiling" and "references pending" on the strip and a
  // dot on the preview tab, none of which is what the README is showing.
  await expect(tab.getByTestId("status")).toHaveAttribute(
    "data-state", /built|ready/, { timeout: 45_000 },
  );
  await tab.waitForTimeout(1200);
}

for (const theme of ["light", "dark"] as const) {
  test(`hero, ${theme}`, async ({ tab }) => {
    // The app chooses its own theme rather than following the OS, and
    // stamps it on the root element before React renders -- so
    // `emulateMedia` does nothing here and the light shot came out dark.
    await tab.evaluate((wanted) => {
      window.localStorage.setItem("nexttex.theme", wanted);
    }, theme);
    await tab.setViewportSize({ width: 1680, height: 1000 });
    await tab.reload();
    await stage(tab);
    await tab.screenshot({ path: `../docs/screenshot-${theme}.png` });
  });
}

/** The editor lit apart from the shell, which is the one thing about this
 *  app that a screenshot explains faster than a sentence: a dark frame
 *  around a white page, because the page is what is being typeset and the
 *  frame is not.  Colouring is switched on here and is off by default --
 *  the README's caption says so -- because the five command families are
 *  the other half of what this picture is for. */
test("a white page in a dark shell", async ({ tab }) => {
  await tab.evaluate(() => {
    window.localStorage.setItem("nexttex.theme", "dark");
    window.localStorage.setItem("nexttex.editor.theme", "white");
    window.localStorage.setItem("nexttex.editor.syntax", "colour");
  });
  await tab.setViewportSize({ width: 1680, height: 1000 });
  await tab.reload();
  await stage(tab);
  await tab.screenshot({ path: "../docs/screenshot-white-page.png" });
});
