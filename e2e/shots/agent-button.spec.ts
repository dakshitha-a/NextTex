import { test, expect } from "../fixtures";

/** Not a check -- a look.  The pill, its mark and its state dot. */
for (const theme of ["light", "dark"]) {
  test(`agent button ${theme}`, async ({ tab }) => {
    await tab.setViewportSize({ width: 1400, height: 800 });
    await tab.evaluate((t) => window.localStorage.setItem("nexttex.theme", t), theme);
    await tab.reload();
    await expect(tab.locator(".cm-editor")).toBeVisible({ timeout: 30_000 });
    await expect(tab.getByTestId("agent-button-claude")).toBeVisible();
    await tab.waitForTimeout(500);
    const box = (await tab.getByTestId("agent-button-claude").boundingBox())!;
    await tab.screenshot({
      path: `shots/out-agent-${theme}.png`,
      clip: {
        x: Math.max(0, box.x - 70), y: Math.max(0, box.y - 40),
        width: box.width + 160, height: box.height + 80,
      },
    });
  });
}
