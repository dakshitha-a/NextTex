import { test, expect, openProject } from "../fixtures";

/** Not a check -- a look.  The tutorial sheet itself, rather than the
 *  figures inside it, which is what `tutorial.spec.ts` makes. */

const CASES = [
  { name: "light", theme: "light", width: 1600 },
  { name: "dark", theme: "dark", width: 1600 },
  { name: "narrow", theme: "light", width: 1000 },
] as const;

for (const shot of CASES) {
  test(`tutorial sheet ${shot.name}`, async ({ app, project, page }) => {
    await page.setViewportSize({ width: shot.width, height: 1000 });
    await page.goto(`${app.base}/?token=${app.token}`);
    await page.evaluate((theme) => {
      window.localStorage.setItem("nexttex.theme", theme);
    }, shot.theme);
    await page.reload();
    await page.getByText("Projects", { exact: false }).first().waitFor();
    await openProject(page, project.root);
    await expect(page.locator(".cm-editor")).toBeVisible({ timeout: 30_000 });
    await page.waitForTimeout(800);

    await page.getByTestId("appearance").first().click();
    await page.getByTestId("tutorial-open").click();
    const sheet = page.getByTestId("tutorial");
    await expect(sheet).toBeVisible({ timeout: 10_000 });
    await page.waitForTimeout(600);
    await sheet.screenshot({ path: `shots/out-tutorial-${shot.name}.png` });

    // The index, which is one click away rather than a third of the sheet.
    await page.getByTestId("tutorial-contents").click();
    await page.waitForTimeout(300);
    await sheet.screenshot({ path: `shots/out-tutorial-${shot.name}-index.png` });
    await page.getByTestId("tutorial-contents").click();
    await page.waitForTimeout(300);

    // And further down, where the figures are.
    await sheet.locator("[data-section='errors']").scrollIntoViewIfNeeded();
    await page.waitForTimeout(500);
    await sheet.screenshot({ path: `shots/out-tutorial-${shot.name}-mid.png` });
  });
}
