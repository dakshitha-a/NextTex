import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";

/** A clean writing session with a real model, one scenario at a time.
 *  Points at the long-lived live server, which is signed in and on Sonnet. */

const BASE = "http://127.0.0.1:8462";
const TOKEN = "live-token";

async function panel(page: Page) {
  return (await page.locator('[data-testid="chat"]').innerText()).replace(/\n{2,}/g, "\n");
}

async function ask(page: Page, question: string) {
  const composer = page.locator("textarea").first();
  await composer.click();
  await composer.fill(question);
  await page.keyboard.press("Enter");
}

/** Answer a card if one appears within `ms`; say whether it did. */
async function answerCard(page: Page, ms = 45_000): Promise<string> {
  const card = page.locator('[data-testid="permission-card"]');
  try {
    await card.waitFor({ timeout: ms });
  } catch {
    return "no card";
  }
  const text = (await card.innerText()).replace(/\n+/g, " | ").slice(0, 300);
  await page.screenshot({ path: "/tmp/review-shots/a7b-card.png" });
  await page.locator('[data-testid="allow"]').first().click();
  return text;
}

async function settle(page: Page, timeout = 240_000) {
  await expect.poll(async () => page.locator('[data-testid="stop"]').count(), { timeout })
    .toBe(0);
  await page.waitForTimeout(1500);
}

test("one turn that edits the document, answered properly", async ({ page }) => {
  await page.goto(`${BASE}/?token=${TOKEN}`);
  await page.getByText("Projects", { exact: false }).first().waitFor({ timeout: 30_000 });
  await page.getByText("Minimal Article", { exact: false }).first().click();
  await page.locator(".cm-editor").waitFor({ timeout: 40_000 });
  await page.waitForTimeout(4000);

  const started = Date.now();
  await ask(page, "Add one sentence to the end of the Discussion section saying that the lifetime grows with edge length. One sentence, no citation.");
  const card = await answerCard(page, 60_000);
  console.log("CARD:", card);
  await settle(page);
  console.log("TURN TOOK:", Date.now() - started, "ms");
  await page.screenshot({ path: "/tmp/review-shots/a7b-01-done.png" });
  const live = await panel(page);
  console.log("PANEL LIVE:\n" + live.slice(0, 2000));

  // Did the file change, and is the edit offered back?
  const chips = await page.locator('[data-testid="edit-chip"]').count();
  console.log("EDIT CHIPS:", chips);

  await page.reload();
  await page.locator(".cm-editor").waitFor({ timeout: 40_000 });
  await page.waitForTimeout(4000);
  const replayed = await panel(page);
  await page.screenshot({ path: "/tmp/review-shots/a7b-02-reloaded.png" });
  console.log("PANEL REPLAYED:\n" + replayed.slice(0, 2000));
  console.log("LENGTHS:", live.length, "live vs", replayed.length, "replayed");
  console.log("EDIT CHIPS AFTER RELOAD:", await page.locator('[data-testid="edit-chip"]').count());
});
