import { test, expect } from "../fixtures";
import type { Page } from "@playwright/test";

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

async function stage(tab: Page) {
  await expect(tab.locator(".cm-editor")).toBeVisible({ timeout: 30_000 });
  // A conversation with something in it: an empty transcript makes the
  // agent column look like an empty box rather than the point of the app.
  const composer = tab.locator("textarea");
  await composer.fill("#script:edit\nTighten the abstract's first sentence.");
  await tab.getByRole("button", { name: "Send" }).click();
  await tab.waitForTimeout(2500);
  await expect(tab.locator("canvas").first()).toBeVisible({ timeout: 45_000 });
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
