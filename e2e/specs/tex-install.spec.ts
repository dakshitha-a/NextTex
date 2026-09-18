import { test, expect } from "@playwright/test";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { ROOT, startServer, seedProject } from "../server";
import { openProject } from "../fixtures";
import { watchEvents } from "../events";

/** The drawer's row for a missing package carries a button.
 *
 *  The server is pointed at `tests/fake_tlmgr.py`, which answers the file
 *  search and the install the way tlmgr does and writes every argv it saw
 *  to a log, so the spec can assert what would have been run without a
 *  mirror.  The build is a real pdflatex over a document that asks for a
 *  package nothing has, which is what produces the row.
 */

async function put(
  app: { base: string; token: string }, projectId: string, path: string, text: string,
) {
  await fetch(`${app.base}/api/projects/${projectId}/file`, {
    method: "PUT",
    headers: { "content-type": "application/json", "x-nexttex-token": app.token },
    body: JSON.stringify({ path, text, compile: false, create: true }),
  });
}

test("a missing package is installed from its row in two presses, and the build follows", async ({
  page,
}, info) => {
  const log = join(info.outputPath(), "tlmgr.jsonl");
  const app = await startServer({
    NEXTTEX_TLMGR: join(ROOT, "tests", "fake_tlmgr.py"),
    NEXTTEX_FAKE_TLMGR_LOG: log,
  });
  try {
    const project = await seedProject(app, `tex-${Date.now()}`);
    await put(
      app, project.id, "main.tex",
      "\\documentclass{article}\n\\usepackage{nothere}\n\\begin{document}\nHello.\n\\end{document}\n",
    );
    await page.goto(`${app.base}/?token=${app.token}`);
    await page.getByText("Projects", { exact: false }).first().waitFor();
    await openProject(page, project.root);
    await expect(page.locator(".cm-editor")).toBeVisible({ timeout: 45_000 });
    const events = await watchEvents(app, project.id);

    // The build fails for want of the file, and the strip opens the drawer.
    await expect(page.getByTestId("status")).toHaveAttribute("data-state", "errors", {
      timeout: 60_000,
    });
    await page.getByTestId("status").click();
    const row = page.getByTestId("diagnostics").getByRole("button", { name: /nothere\.sty/ }).first();
    await row.click();

    // The row asked which package provides the file, and says so.
    const install = page.getByTestId("tex-install");
    await expect(install).toHaveText("Install nothere-pkg", { timeout: 15_000 });
    await install.click();
    await expect(install).toHaveText("Yes, install nothere-pkg");
    await expect(page.getByTestId("diagnostics")).toContainText("Downloads nothere-pkg from a CTAN mirror");
    const builds = events.count("compile_start");
    await install.click();
    await expect(page.getByTestId("tex-install-done")).toBeVisible({ timeout: 15_000 });

    // The stand-in saw exactly the search and the install, and a build
    // followed the install.
    const calls = readFileSync(log, "utf-8").trim().split("\n").map((line) => JSON.parse(line));
    expect(calls).toEqual([
      ["search", "--file", "--global", "/nothere.sty"],
      ["install", "nothere-pkg"],
    ]);
    await expect.poll(() => events.count("compile_start"), { timeout: 30_000 })
      .toBeGreaterThan(builds);
    events.stop();

    // A failing install shows the manager's own words under the row.
    await put(
      app, project.id, "main.tex",
      "\\documentclass{article}\n\\usepackage{stale}\n\\begin{document}\nHello.\n\\end{document}\n",
    );
    await fetch(`${app.base}/api/projects/${project.id}/compile`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-nexttex-token": app.token },
      body: JSON.stringify({ full: true }),
    });
    const stale = page.getByTestId("diagnostics").getByRole("button", { name: /stale\.sty/ }).first();
    await stale.click({ timeout: 30_000 });
    const again = page.getByTestId("tex-install");
    await expect(again).toHaveText("Install stale-pkg", { timeout: 15_000 });
    await again.click();
    await again.click();
    await expect(page.getByTestId("tex-install-error")).toContainText(
      "Remote repository is newer than local", { timeout: 15_000 },
    );
    expect(existsSync(log)).toBe(true);
  } finally {
    await app.stop();
  }
});
