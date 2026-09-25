import { test, expect, openFolders } from "../fixtures";
import type { Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

/** Every surface `a11y.spec.ts` does not visit.
 *
 *  That spec covers the project list, the editor, the permission card, the
 *  upload chooser, the folder list and the tutorial.  This one opens the
 *  rest: the settings sheet, the panels in the rail, the drawers, the menus
 *  and the sign-in screen, in both themes, and prints what axe says. */

const ALLOWED = ["scrollable-region-focusable"];

async function sweep(page: Page, where: string) {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa"])
    .analyze();
  const bad = results.violations.filter(
    (v) => !ALLOWED.includes(v.id) && ["serious", "critical"].includes(v.impact ?? ""),
  );
  // Soft, so the sweep goes on and says everything it found, and the
  // test still fails for it.
  expect.soft(bad.map((v) => `${v.id}: ${v.help}`), where).toEqual([]);
  if (!bad.length) {
    console.log(`OK   ${where}`);
    return;
  }
  for (const v of bad) {
    console.log(`AXE  ${where}: ${v.id} (${v.impact}) ${v.help}`);
    for (const n of v.nodes.slice(0, 4)) {
      console.log(`       ${n.target.join(" ")}`);
      const summary = (n.failureSummary ?? "").split("\n").filter(Boolean).slice(0, 3);
      for (const line of summary) console.log(`         ${line.trim()}`);
    }
  }
}

async function dress(page: Page, theme: string) {
  await page.evaluate((t) => window.localStorage.setItem("nexttex.theme", t), theme);
  await page.reload();
  await page.locator(".cm-editor").waitFor({ timeout: 30_000 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.waitForTimeout(800);
}

/** Press a control the sweep needs. A control it cannot find or press is
 *  a failure: this sweep skipped five of its eight surfaces once the
 *  visual overhaul renamed them, and passed (Q-056). */
async function click(page: Page, selector: string, label: string): Promise<void> {
  const target = page.locator(selector).first();
  await expect(target, `${label}: no ${selector}`).toHaveCount(1, { timeout: 10_000 });
  await target.click({ timeout: 10_000 });
  await page.waitForTimeout(700);
}

/** Every drawer the bar opens, in the bar's order. */
const DRAWERS = [
  "files", "sections", "search", "papers", "history", "git", "people",
  "comments", "build", "submit", "download", "trash",
];

for (const theme of ["light", "dark"] as const) {
  test(`the surfaces the accessibility spec does not visit, ${theme}`, async ({ tab }) => {
    const page = tab;
    await dress(page, theme);

    // Every drawer, from the bar.
    for (const id of DRAWERS) {
      const showing = (await page.getByTestId("drawer").getAttribute("data-drawer")) === id;
      if (!showing) await click(page, `[data-testid="bar-${id}"]`, `${id} drawer ${theme}`);
      await sweep(page, `${id} drawer ${theme}`);
    }

    // The settings sheet.
    await click(page, '[aria-label="Settings"]', `settings ${theme}`);
    await page.waitForTimeout(1200);
    await sweep(page, `settings sheet ${theme}`);
    await click(page, '[data-testid="settings-close"]', "settings close");

    // A file row's own menu.
    await click(page, '[data-testid="bar-files"]', "files again");
    await openFolders(page, "main.tex");
    await click(page, '[aria-label="Actions for main.tex"]', `file row menu ${theme}`);
    await sweep(page, `file row menu ${theme}`);
    await page.keyboard.press("Escape");

    // The Claude column's composer menu.
    await click(page, '[data-testid="model-open"]', `composer menu ${theme}`);
    await sweep(page, `composer menu ${theme}`);
    await page.keyboard.press("Escape");
  });
}

test("the sign-in screen, both themes", async ({ page }) => {
  const { startServer } = await import("../server");
  const app = await startServer({ NEXTTEX_FAKE_CLAUDE_AUTH: "" });
  try {
    for (const theme of ["light", "dark"] as const) {
      await page.goto(app.base);
      await page.evaluate((t) => window.localStorage.setItem("nexttex.theme", t), theme);
      await page.reload();
      await page.waitForTimeout(1500);
      await page.emulateMedia({ reducedMotion: "reduce" });
      await sweep(page, `sign-in ${theme}`);
      await page.screenshot({ path: `/tmp/review-shots/signin-${theme}.png` });
    }
  } finally {
    await app.stop();
  }
});
