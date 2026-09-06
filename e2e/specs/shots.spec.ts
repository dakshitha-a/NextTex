import { test, expect } from "../fixtures";
import type { Page } from "@playwright/test";

/** The README's screenshots, captured against a real instance rather than
 *  mocked up.  Not part of any tier: run it by hand with
 *  `playwright test specs/shots.spec.ts` when the interface changes. */

test.skip(!process.env.NEXTTEX_SHOTS, "set NEXTTEX_SHOTS=1 to capture");

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
  test(`hero, ${theme}`, async ({ page, tab }) => {
    await page.emulateMedia({ colorScheme: theme });
    await tab.setViewportSize({ width: 1680, height: 1000 });
    await stage(tab);
    await tab.screenshot({ path: `../docs/screenshot-${theme}.png` });
  });
}
