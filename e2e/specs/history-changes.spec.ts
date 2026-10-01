import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test, expect, openProject } from "../fixtures";
import { ROOT, seedProject, startServer } from "../server";

/** Typeset changes against a version in History.
 *
 *  Many writers here never commit, so the marked-up PDF the Git drawer
 *  makes since a commit comes from History too: a named version offers
 *  Changes as PDF under the pointer, and every version in its menu. The
 *  stand-in for latexdiff takes the real one's place.
 */
test("a named version offers its changes as a typeset PDF", async ({ page }) => {
  const app = await startServer({ NEXTTEX_LATEXDIFF: join(ROOT, "tests", "fake_latexdiff.py") });
  try {
    const project = await seedProject(app, `history-changes-${Date.now()}`);
    const put = (text: string) =>
      fetch(`${app.base}/api/projects/${project.id}/file`, {
        method: "PUT",
        headers: { "content-type": "application/json", "x-nexttex-token": app.token },
        body: JSON.stringify({ path: "main.tex", text, compile: false }),
      });
    await page.goto(`${app.base}/?token=${app.token}`);
    await page.getByText("Projects", { exact: false }).first().waitFor();
    await openProject(page, project.root);
    await expect(page.locator(".cm-editor")).toBeVisible({ timeout: 45_000 });

    const main = join(project.root, "main.tex");
    const before = readFileSync(main, "utf-8");
    await put(before.replace("\\end{document}", "Submitted text.\n\\end{document}"));
    const versions = await (await fetch(
      `${app.base}/api/projects/${project.id}/history?path=main.tex`,
      { headers: { "x-nexttex-token": app.token } },
    )).json();
    const sha = versions.versions[versions.versions.length - 1].sha;
    await fetch(`${app.base}/api/projects/${project.id}/history/label`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-nexttex-token": app.token },
      body: JSON.stringify({ path: "main.tex", sha, label: "submitted v1" }),
    });
    writeFileSync(main, before.replace("\\end{document}", "Revised text.\n\\end{document}"));

    await page.getByTestId("bar-history").click();
    const row = page.locator(`[data-testid="version"][data-sha="${sha}"]`);
    await expect(row).toContainText("submitted v1", { timeout: 20_000 });
    await row.hover();
    const opened = page.context().waitForEvent("page");
    await row.getByTestId("version-changes-pdf").click();
    const tab = await opened;
    await tab.waitForURL(/\/git\/changes\/main-at-\d{8}-\d{6}\.pdf$/, { timeout: 60_000 });
  } finally {
    await app.stop();
  }
});
