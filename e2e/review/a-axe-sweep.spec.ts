import { test, openFolders } from "../fixtures";
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

async function click(page: Page, selector: string, label: string): Promise<boolean> {
  const target = page.locator(selector).first();
  if (!(await target.count())) {
    console.log(`SKIP ${label}: no ${selector}`);
    return false;
  }
  try {
    await target.click({ timeout: 5000 });
    await page.waitForTimeout(700);
    return true;
  } catch {
    console.log(`SKIP ${label}: ${selector} would not take a click`);
    return false;
  }
}

for (const theme of ["light", "dark"] as const) {
  test(`the surfaces the accessibility spec does not visit, ${theme}`, async ({ tab }) => {
    const page = tab;
    await dress(page, theme);

    // The rail's panels.
    if (await click(page, '[data-testid="sections-toggle"]', `sections ${theme}`)) {
      await sweep(page, `sections panel ${theme}`);
    }
    if (await click(page, '[data-testid="files-toggle"]', `files ${theme}`)) {
      await sweep(page, `files folded ${theme}`);
      await click(page, '[data-testid="files-toggle"]', "files back");
    }

    // The settings sheet.
    if (await click(page, '[aria-label="Settings"]', `settings ${theme}`)) {
      await page.waitForTimeout(1200);
      await sweep(page, `settings sheet ${theme}`);
      await click(page, '[data-testid="settings-close"]', "settings close");
    }

    // The share panel.
    if (await click(page, '[aria-label="Share this project"]', `share ${theme}`)) {
      await page.waitForTimeout(800);
      await sweep(page, `share panel ${theme}`);
      await click(page, '[data-testid="share-close"]', "share close");
    }

    // The diagnostics drawer.
    if (await click(page, '[data-testid="status"]', `status ${theme}`)) {
      await sweep(page, `diagnostics drawer ${theme}`);
    }

    // The download menu on the project bar.
    if (await click(page, '[data-testid="open-download"]', `downloads ${theme}`)) {
      await sweep(page, `download menu ${theme}`);
      await page.keyboard.press("Escape");
    }

    // The history panel, opened on a real file.
    await openFolders(page, "main.tex");
    if (await click(page, '[aria-label="Actions for main.tex"]', `history ${theme}`)) {
      await page.waitForTimeout(900);
      await sweep(page, `history panel ${theme}`);
    }

    // The tab strip's own menu.
    const tabRow = page.locator('[data-testid="tab"], [role="tab"]').first();
    if (await tabRow.count()) {
      await tabRow.click({ button: "right" }).catch(() => undefined);
      await page.waitForTimeout(500);
      await sweep(page, `tab menu ${theme}`);
      await page.keyboard.press("Escape");
    }

    // A file row's own menu.
    const row = page.locator('[role="tree"] [data-path="main.tex"]').first();
    if (await row.count()) {
      await row.click({ button: "right" }).catch(() => undefined);
      await page.waitForTimeout(500);
      await sweep(page, `file row menu ${theme}`);
      await page.keyboard.press("Escape");
    }

    // The agent panel at rest, and its composer.
    if (await click(page, '[data-testid="agent-pill"], [data-testid="chat-header"]', `chat ${theme}`)) {
      await page.waitForTimeout(900);
      await sweep(page, `agent panel ${theme}`);
    }
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
