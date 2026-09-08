import { rmSync } from "node:fs";
import { test, expect } from "../fixtures";

/** Not a check -- a look.  The dead row, and the row asking where it went. */
for (const theme of ["light", "dark"]) {
  test(`a missing project ${theme}`, async ({ app, project, page }) => {
    rmSync(project.root, { recursive: true, force: true });
    await page.goto(`${app.base}/?token=${app.token}`);
    await page.evaluate((t) => window.localStorage.setItem("nexttex.theme", t), theme);
    await page.reload();
    await expect(page.getByText("This folder is no longer there.")).toBeVisible({
      timeout: 20_000,
    });
    await page.screenshot({ path: `shots/out-missing-${theme}.png`,
                            clip: { x: 100, y: 230, width: 1500, height: 220 } });
    await page.getByTestId("find-project").click();
    await page.screenshot({ path: `shots/out-missing-${theme}-finding.png`,
                            clip: { x: 100, y: 230, width: 1500, height: 260 } });
  });
}
