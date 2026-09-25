import { test, expect, openProject } from "../fixtures";
import { writeFileSync } from "node:fs";
import { join } from "node:path";

/** A build with more warnings than the drawer lists says how many more.
 *
 *  The probe (Q-043) found a draft's 72,000 warnings sent to every tab and
 *  the server frozen while it made them. The server now sends at most 500
 *  and counts the rest: the strip counts them all, and the Build drawer
 *  ends its list with one line saying how many more there are. */
test("a build with 600 warnings lists 500 and says how many more", async ({ app, project, page }) => {
  const refs = Array.from({ length: 600 }, (_, i) => `\\ref{missing${i}}`).join(" ");
  writeFileSync(join(project.root, "main.tex"),
    `\\documentclass{article}\n\\begin{document}\n${refs}\n\\end{document}\n`);
  await page.goto(`${app.base}/?token=${app.token}`);
  await page.getByText("Projects", { exact: false }).first().waitFor();
  await openProject(page, project.root);
  const status = page.getByTestId("status");
  await expect(status).toContainText(/60\d warnings/, { timeout: 45_000 });
  await status.click();
  const list = page.getByTestId("diagnostics");
  await expect(list.getByTestId("build-omitted")).toContainText(/And 10\d more warnings, not listed here/);
  if (process.env.NEXTTEX_SHOT) {
    await list.screenshot({ path: process.env.NEXTTEX_SHOT });
  }
});
