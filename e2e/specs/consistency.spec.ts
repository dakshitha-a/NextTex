import { test, expect } from "../fixtures";

/** Consistency checks that need no model.
 *
 *  A word written two ways, an abbreviation beside its full form, US
 *  beside UK spelling, an acronym defined and unused: rows in the Build
 *  drawer, read over the whole project's prose, only where two forms of
 *  one thing coexist, and only on the less common form. A row names the
 *  other form's place as a button that goes there.
 */

test("a word written two ways is a row that leads to the other form", async ({ app, project, tab }) => {
  const put = (path: string, text: string) =>
    fetch(`${app.base}/api/projects/${project.id}/file`, {
      method: "PUT",
      headers: { "content-type": "application/json", "x-nexttex-token": app.token },
      body: JSON.stringify({ path, text, compile: false, create: true }),
    });
  await expect(tab.locator(".cm-editor")).toBeVisible({ timeout: 45_000 });
  await put("notes.tex", [
    "\\documentclass{article}",
    "\\begin{document}",
    "The dataset was cleaned, and the dataset was split.",
    "We then wrote up the data set.",
    "As in Fig.~1, it rises; as in Fig.~2 it falls.",
    "\\end{document}",
    "",
  ].join("\n"));
  await tab.locator('[role="tree"] [data-path="notes.tex"]').click();
  await expect(tab.locator(".cm-content")).toContainText("data set", { timeout: 15_000 });

  const drawer = tab.getByTestId("diagnostics");
  await expect(async () => {
    await tab.keyboard.press("F8");
    await expect(drawer).toBeVisible({ timeout: 700 });
  }).toPass({ timeout: 20_000 });
  const row = drawer.locator("div.group").filter({ hasText: '"data set" here, "dataset" twice elsewhere' });
  await expect(row).toBeVisible({ timeout: 15_000 });
  // "Fig." is used throughout, so nothing is marked: one form is a style.
  await expect(drawer.getByText(/"Fig\."/)).toHaveCount(0);
  // The more common form is the writer's convention and is not a row.
  await expect(drawer.getByText('"dataset" here')).toHaveCount(0);

  const other = row.getByTestId("diagnostic-other");
  await expect(other).toHaveText("notes.tex:3");
  await other.click();
  await expect(tab.locator(".cm-activeLine")).toContainText("The dataset was cleaned");
});
