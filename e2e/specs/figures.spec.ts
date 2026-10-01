import { test, expect } from "../fixtures";

/** The Sections drawer's Figures list.
 *
 *  Every figure and table the document reaches, in reading order, with its
 *  number and page from the last build, its caption, and how often the
 *  text refers to it; one never referred to says so. A press opens the
 *  source at it. The switch between Sections and Figures is remembered.
 */

test("figures and tables are listed with their references, and a press opens one", async ({ app, project, tab }) => {
  await expect(tab.locator(".cm-editor")).toBeVisible({ timeout: 45_000 });
  // A table the text never mentions, at the end of the document.
  const main = await (await fetch(`${app.base}/api/projects/${project.id}/file?path=main.tex`, {
    headers: { "x-nexttex-token": app.token },
  })).json();
  const text = (main.text as string).replace(
    "\\end{document}",
    "\\begin{table}\n  \\caption{Nobody cites this table}\n  \\label{tab:lonely}\n  \\begin{tabular}{c}x\\end{tabular}\n\\end{table}\n\\end{document}",
  );
  await fetch(`${app.base}/api/projects/${project.id}/file`, {
    method: "PUT",
    headers: { "content-type": "application/json", "x-nexttex-token": app.token },
    body: JSON.stringify({ path: "main.tex", text, compile: true }),
  });

  await tab.getByTestId("bar-sections").click();
  await tab.getByTestId("structure-figures").click();
  const rows = tab.getByTestId("figure-row");
  const lonely = rows.filter({ hasText: "Nobody cites this table" });
  await expect(lonely).toBeVisible({ timeout: 30_000 });
  await expect(lonely).toContainText("not referenced");
  await expect(lonely).not.toHaveAttribute("data-referenced", "true");
  // After the build, numbers and pages.
  await expect(lonely).toContainText(/Table \d+\s*p\. \d+/, { timeout: 60_000 });

  await lonely.click();
  await expect(tab.locator(".cm-activeLine")).toContainText("\\begin{table}");

  // The choice is remembered.
  await tab.reload();
  await expect(tab.locator(".cm-editor")).toBeVisible({ timeout: 45_000 });
  if ((await tab.getByTestId("drawer").getAttribute("data-drawer").catch(() => null)) !== "sections") {
    await tab.getByTestId("bar-sections").click();
  }
  await expect(tab.getByTestId("figures-list")).toBeVisible();
});
