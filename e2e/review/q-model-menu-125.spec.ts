import { test, expect } from "../fixtures";

/** Whether the composer's model menu opens at a device pixel ratio of 1.25.
 *  The probe's 1.25 sweep never caught it open; this settles whether that
 *  was the app or the sweep's timing. */
test.use({ deviceScaleFactor: Number(process.env.Q_DPR ?? "1.25"), viewport: { width: 1600, height: 1000 } });

test("the model menu opens at 1.25", async ({ tab }) => {
  await expect(tab.locator(".cm-editor")).toBeVisible({ timeout: 30_000 });
  const open = tab.getByTestId("model-open");
  await open.waitFor({ timeout: 20_000 });
  await tab.waitForTimeout(Number(process.env.Q_SETTLE ?? "0"));
  const t0 = Date.now();
  await open.click();
  await tab.getByTestId("model-menu").waitFor({ timeout: 10_000 });
  console.log(`first open: the menu appeared ${Date.now() - t0} ms after the click`);
  await tab.keyboard.press("Escape");
  await tab.waitForTimeout(300);
  for (const wait of [200, 600, 1500]) {
    await open.click();
    const shown = await tab.getByTestId("model-menu").isVisible().catch(() => false);
    await tab.waitForTimeout(wait);
    const later = await tab.getByTestId("model-menu").isVisible().catch(() => false);
    console.log(`clicked: visible at once=${shown}, after ${wait} ms=${later}`);
    await tab.keyboard.press("Escape");
    await tab.waitForTimeout(300);
  }
});
