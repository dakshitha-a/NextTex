import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test, expect } from "../fixtures";

/** The Sections drawer's Typeset list.
 *
 *  The writer asked for the whole outline of the document in the preview
 *  beside the outline of the file in the editor: every heading it reaches
 *  through its inputs, in reading order, with its number and page from the
 *  last build. A press shows the place on the page; Source, under the
 *  pointer, opens it in the editor. */

test("the previewed document's headings across its files, with numbers and pages", async ({ app, project, tab }) => {
  await expect(tab.locator(".cm-editor")).toBeVisible({ timeout: 45_000 });
  mkdirSync(join(project.root, "chapters"), { recursive: true });
  writeFileSync(join(project.root, "chapters", "results.tex"), [
    "\\section{Results from the chapter}",
    "Some words.",
    "\\subsection{A deeper part}",
    "More words.",
    "\\newpage",
    "\\subsection{On a later page}",
    "The end.",
    "",
  ].join("\n"));
  const main = await (await fetch(`${app.base}/api/projects/${project.id}/file?path=main.tex`, {
    headers: { "x-nexttex-token": app.token },
  })).json();
  const text = (main.text as string).replace("\\end{document}", "\\input{chapters/results}\n\\end{document}");
  await fetch(`${app.base}/api/projects/${project.id}/file`, {
    method: "PUT",
    headers: { "content-type": "application/json", "x-nexttex-token": app.token },
    body: JSON.stringify({ path: "main.tex", text, compile: true }),
  });

  await tab.getByTestId("bar-sections").click();
  await tab.getByTestId("structure-typeset").click();
  const rows = tab.getByTestId("typeset-row");
  const chapter = rows.filter({ hasText: "Results from the chapter" });
  await expect(chapter).toBeVisible({ timeout: 30_000 });
  await expect(chapter).toHaveAttribute("data-file", "chapters/results.tex");
  // main.tex's own headings come first, in the order the reader meets them.
  const titles = await rows.locator(".nx-row-label").allTextContents();
  expect(titles.indexOf("Results from the chapter")).toBeGreaterThan(0);
  expect(titles.indexOf("On a later page")).toBe(titles.length - 1);
  // After the build, a number and a page.
  const later = rows.filter({ hasText: "On a later page" });
  await expect(later).toContainText(/p\. \d+/, { timeout: 60_000 });
  await expect(later.locator(".nx-typeset-number")).toHaveText(/^\d+\.\d+$/);

  // A press shows its place on the page.
  const page = await later.locator(".nx-typeset-page").textContent();
  const want = Number(page!.replace(/\D/g, ""));
  await later.click();
  await expect.poll(async () => Number(await tab.getByLabel("Page", { exact: true }).inputValue().catch(() => "0")), { timeout: 10_000 })
    .toBe(want);

  // Source, under the pointer, opens it in the editor.
  await later.hover();
  await later.locator("..").getByTestId("typeset-source").click();
  await expect(tab.locator(".cm-activeLine")).toContainText("On a later page");

  // The choice is remembered.
  await tab.reload();
  await expect(tab.locator(".cm-editor")).toBeVisible({ timeout: 45_000 });
  if ((await tab.getByTestId("drawer").getAttribute("data-drawer").catch(() => null)) !== "sections") {
    await tab.getByTestId("bar-sections").click();
  }
  await expect(tab.getByTestId("typeset-list")).toBeVisible();
});
