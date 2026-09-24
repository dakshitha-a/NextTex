import { test, expect, openProject } from "../fixtures";
import { execFileSync } from "node:child_process";
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/** A write from outside NextTex reaches the preview.
 *
 *  The files are the writer's own, on their own disk, so another editor,
 *  a `git pull` or another agent may change them while NextTex is open.
 *  The watcher folded such a write into the shared document, so the
 *  editor showed it, but a build followed only a projection of the
 *  document to disk, and a change that came from disk is projected
 *  nowhere: the page stayed as it was until the writer typed.  Now the
 *  watcher's tick tells the compiler what changed, the way a keystroke
 *  does, and the page follows.
 */

function textOf(pdf: string): string {
  try {
    return execFileSync("pdftotext", ["-layout", pdf, "-"], { encoding: "utf-8" });
  } catch {
    return "";
  }
}

test("a pull that adds a part and inputs it reaches the page without a keystroke", async ({
  tab, project,
}) => {
  await expect
    .poll(async () => tab.getByTestId("status").getAttribute("data-state"), { timeout: 45_000 })
    .toBe("built");
  const pdf = join(project.root, "build", "main.pdf");
  expect(textOf(pdf)).not.toContain("Pulled from elsewhere");

  // Two files in one write, the shape of a pull: a new part, and the
  // main file changed to input it.  Neither is typed here.
  const main = join(project.root, "main.tex");
  writeFileSync(join(project.root, "part.tex"), "Pulled from elsewhere.\n");
  writeFileSync(
    main,
    readFileSync(main, "utf-8").replace("\\section{Results}", "\\input{part}\n\n\\section{Results}"),
  );

  await expect
    .poll(() => textOf(pdf), { timeout: 60_000, intervals: [1000] })
    .toContain("Pulled from elsewhere");
  // The editor, which had main.tex open, shows the same write.
  await expect(tab.locator(".cm-line", { hasText: "\\input{part}" })).toBeVisible();
  await expect(tab.getByTestId("status")).toHaveAttribute("data-state", "built");
});

test("an entry added to the bibliography from outside resolves the citation", async ({
  app, project, page,
}) => {
  // A citation of a key the bibliography does not hold yet, in place
  // before the project opens, so the opening build leaves it unresolved.
  const main = join(project.root, "main.tex");
  writeFileSync(
    main,
    readFileSync(main, "utf-8").replace(
      "\\section{Results}",
      "As Lamport wrote~\\cite{lamport1994}.\n\n\\section{Results}",
    ),
  );
  await page.goto(`${app.base}/?token=${app.token}`);
  await page.getByText("Projects", { exact: false }).first().waitFor();
  await openProject(page, project.root);
  await expect
    .poll(async () => page.getByTestId("status").getAttribute("data-state"), { timeout: 45_000 })
    .toBe("built");
  const pdf = join(project.root, "build", "main.pdf");
  await expect.poll(() => textOf(pdf), { timeout: 30_000 }).toContain("lamport1994");

  // The entry arrives from a reference manager, not from this keyboard.
  // A fast pass runs no biber and would leave the citation as it was;
  // an outside write to a .bib is the citation change it is.
  appendFileSync(
    join(project.root, "references.bib"),
    "\n@book{lamport1994,\n  title = {LaTeX: A Document Preparation System},\n" +
      "  author = {Lamport, Leslie},\n  year = {1994},\n  publisher = {Addison-Wesley}\n}\n",
  );

  await expect
    .poll(() => textOf(pdf), { timeout: 60_000, intervals: [1000] })
    .toContain("Document Preparation System");
  expect(textOf(pdf)).not.toContain("lamport1994");
  await expect(page.getByTestId("status")).toHaveAttribute("data-state", "built");
});

test("an outside edit is the disk's in History, and the editor shows it", async ({ tab, project }) => {
  // Raised by the writer on 24 September: a change made to the file on
  // disk shows in History as the disk's, not the writer's.
  await expect(tab.locator(".cm-editor")).toBeVisible({ timeout: 45_000 });
  const main = join(project.root, "main.tex");
  appendFileSync(main, "Written by another editor.\n");
  // The editor draws only the lines on screen, and this one is appended
  // at the end.
  await tab.locator(".cm-content").click();
  await expect.poll(async () => {
    await tab.keyboard.press("Control+End");
    return tab.locator(".cm-line", { hasText: "Written by another editor." }).count();
  }, { timeout: 20_000 }).toBeGreaterThan(0);
  await expect(tab.locator(".cm-line", { hasText: "Written by another editor." })).toBeVisible({
    timeout: 20_000,
  });

  await tab.getByTestId("bar-history").click();
  const newest = tab.getByTestId("version").first();
  await expect(newest.getByTestId("version-who")).toHaveText("On disk", { timeout: 15_000 });
  await expect(newest).toContainText("changed outside NextTex");
  await expect(newest.getByTestId("version-who")).toHaveClass(/text-ink-2/);
});
