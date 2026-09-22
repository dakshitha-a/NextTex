import { test, expect, openProject } from "../fixtures";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/** The preview settles on its own.
 *
 *  A writer saw figures on the wrong page until they commented them out,
 *  built, uncommented and pressed Rebuild everything.  Compile as you
 *  type is one engine pass, and a single pass typesets against the last
 *  pass's aux files, so wherever an edit shifted a page the flow of that
 *  pass, and where its floats land, was one pass behind; the engine said
 *  so in its log and nothing read it.  Now a fast pass that leaves the
 *  document unconverged is followed by a settling full build, without
 *  the writer asking.
 *
 *  An edit to the main file always takes the full pass, so the edit here
 *  goes into a file the main file inputs, which is the fast path.
 */

function pagesOf(pdf: string): string[] {
  // pdftotext parts pages with a form feed.
  return execFileSync("pdftotext", ["-layout", pdf, "-"], { encoding: "utf-8" }).split("\f");
}

test("a page that moved is referred to by its new number without a rebuild", async ({ app, project, page }) => {
  // A part the main file inputs, saying which page Results is on, in
  // place before the project opens, so the opening build, a full pass,
  // settles both before the fast edit below.
  const main = join(project.root, "main.tex");
  writeFileSync(join(project.root, "part.tex"), "Results are on page~\\pageref{sec:results}.\n");
  const source = readFileSync(main, "utf-8");
  writeFileSync(main, source.replace("\\section{Results}", "\\input{part}\n\n\\section{Results}"));
  await page.goto(`${app.base}/?token=${app.token}`);
  await page.getByText("Projects", { exact: false }).first().waitFor();
  await openProject(page, project.root);
  const tab = page;
  await expect
    .poll(async () => tab.getByTestId("status").getAttribute("data-state"), { timeout: 45_000 })
    .toBe("built");
  await expect
    .poll(() => {
      try {
        return pagesOf(join(project.root, "build", "main.pdf")).join("\n");
      } catch {
        return "";
      }
    }, { timeout: 60_000 })
    .toMatch(/Results are on page\s+1\./);

  // Now the edit that shifts Results to a later page, typed into the part:
  // the fast pass still says page 1 from the old aux, and asks to be run
  // again; the settling build says the page Results is now on.
  await tab.getByRole("treeitem", { name: /part\.tex/ }).click();
  await expect(tab.locator(".cm-line", { hasText: "Results are on page" })).toBeVisible({ timeout: 10_000 });
  await tab.locator(".cm-content").click();
  await tab.keyboard.press("Control+End");
  await tab.keyboard.type("\n\\newpage\nMoved.\n\\newpage\nMoved again.\n");

  await expect
    .poll(() => {
      try {
        const pages = pagesOf(join(project.root, "build", "main.pdf"));
        const results = pages.findIndex((page) => /^\s*2\s+Results/m.test(page)) + 1;
        const said = pages.join("\n").match(/Results are on page\s+(\d+)\./);
        return results > 1 && said ? `${said[1]} of ${results}` : "";
      } catch {
        return "";
      }
    }, { timeout: 60_000, intervals: [1000] })
    .toMatch(/^(\d+) of \1$/);
  // Nothing was pressed: the strip's Rebuild was never used.
  await expect(tab.getByTestId("status")).toHaveAttribute("data-state", "built");
});
