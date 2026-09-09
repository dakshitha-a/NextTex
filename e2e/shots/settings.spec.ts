import { test, expect, openProject } from "../fixtures";

/** Not a check -- a look.  The settings sheet, in both themes and at the
 *  width where its two columns become one. */

const CASES = [
  { name: "light", theme: "light", width: 1600 },
  { name: "dark", theme: "dark", width: 1600 },
  { name: "narrow", theme: "light", width: 700 },
] as const;

for (const shot of CASES) {
  test(`settings ${shot.name}`, async ({ app, project, page }) => {
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
    const sheet = page.getByTestId("settings-sheet");
    await expect(sheet).toBeVisible({ timeout: 10_000 });
    await page.waitForTimeout(400);
    await sheet.screenshot({ path: `shots/out-settings-${shot.name}.png` });
  });
}
