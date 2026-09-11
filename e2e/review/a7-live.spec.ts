import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

/** A real writing session with a real model.
 *
 *  Points at the long-lived live server on 8462 rather than starting one,
 *  because that one is signed in to a real account and pinned to Sonnet.
 *  Nothing here presses sign out. */

const BASE = "http://127.0.0.1:8462";
const TOKEN = "live-token";

async function ask(page: Page, question: string) {
  const composer = page.locator("textarea").first();
  await composer.click();
  await composer.fill(question);
  await page.keyboard.press("Enter");
}

async function settle(page: Page, timeout = 180_000) {
  // The panel is done when the thinking indicator is gone and Send is back.
  await expect
    .poll(async () => page.locator('[data-testid="stop"]').count(), { timeout })
    .toBe(0);
  await page.waitForTimeout(1500);
}

async function panel(page: Page) {
  return (await page.locator('[data-testid="chat"]').innerText())
    .replace(/\n{2,}/g, "\n");
}

test("a real turn, on Sonnet, start to finish", async ({ page }) => {
  await page.goto(`${BASE}/?token=${TOKEN}`);
  await page.getByText("Projects", { exact: false }).first().waitFor({ timeout: 30_000 });
  await page.getByText("Minimal Article", { exact: false }).first().click();
  await page.locator(".cm-editor").waitFor({ timeout: 40_000 });
  await page.waitForTimeout(3000);

  // The panel is open by default in a wide window; make sure.
  const composer = page.locator("textarea").first();
  if (!(await composer.count())) {
    await page.locator('[data-testid="agent-pill"]').click().catch(() => undefined);
    await page.waitForTimeout(1200);
  }
  await page.screenshot({ path: "/tmp/review-shots/a7-00-before.png" });

  const started = Date.now();
  await ask(page, "Add one short sentence to the abstract saying what the work found. Keep it to one sentence.");
  // How long until the first token appears?
  await expect.poll(async () => (await panel(page)).length, { timeout: 120_000 })
    .toBeGreaterThan(200);
  console.log("FIRST OUTPUT AFTER:", Date.now() - started, "ms");
  await page.screenshot({ path: "/tmp/review-shots/a7-01-midturn.png" });
  await settle(page);
  console.log("TURN TOOK:", Date.now() - started, "ms");
  await page.screenshot({ path: "/tmp/review-shots/a7-02-done.png" });
  const live = await panel(page);
  console.log("PANEL LIVE:\n" + live.slice(0, 2500));

  // The question this area exists for: does a reload rebuild the same panel?
  await page.reload();
  await page.locator(".cm-editor").waitFor({ timeout: 40_000 });
  await page.waitForTimeout(4000);
  const replayed = await panel(page);
  await page.screenshot({ path: "/tmp/review-shots/a7-03-reloaded.png" });
  console.log("PANEL REPLAYED:\n" + replayed.slice(0, 2500));
  console.log("SAME LENGTH:", live.length, "vs", replayed.length);

  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
  for (const v of results.violations.filter(
    (v) => v.id !== "scrollable-region-focusable" && ["serious", "critical"].includes(v.impact ?? ""))) {
    console.log(`AXE live panel: ${v.id} (${v.impact}) ${v.help}`);
  }
});
