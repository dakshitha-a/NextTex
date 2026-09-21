import { test, expect, openProject } from "../fixtures";

/** Not a check -- a look.  The settings sheet, in both themes and at the
 *  width where its two columns become one; and the While you write group
 *  in both themes, with its hover cards rows, which is the fidelity
 *  render the direction page's drawing of that group is held against. */

const CASES = [
  { name: "light", theme: "light", width: 1600, group: "look" },
  { name: "dark", theme: "dark", width: 1600, group: "look" },
  { name: "narrow", theme: "light", width: 700, group: "look" },
  { name: "write-light", theme: "light", width: 1600, group: "write" },
  { name: "write-dark", theme: "dark", width: 1600, group: "write" },
  { name: "write-off", theme: "dark", width: 1600, group: "write", hover: "off" },
] as const;

for (const shot of CASES) {
  test(`settings ${shot.name}`, async ({ app, project, page }) => {
    await page.setViewportSize({ width: shot.width, height: 1000 });
    await page.goto(`${app.base}/?token=${app.token}`);
    await page.evaluate(({ theme, group, hover }) => {
      window.localStorage.setItem("nexttex.theme", theme);
      window.localStorage.setItem("nexttex.settings.group", group);
      if (hover) window.localStorage.setItem("nexttex.editor.hover", hover);
    }, { theme: shot.theme, group: shot.group, hover: "hover" in shot ? shot.hover : "" });
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
