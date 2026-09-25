import { test, expect, openProject } from "../fixtures";
import { watchEvents } from "../events";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/** A chapter's build keeps the other chapters' errors.
 *
 *  Once a document's full build takes more than two seconds, a fast build
 *  compiles only the chapter being edited, and TeX never opens the other
 *  chapters. The probe of September 2026 (Q-017) found the session took
 *  that build's list as the document's whole list, so an error still in
 *  chapter 00 left the gutter, the drawer and the strip the moment the
 *  writer typed in chapter 01, and the strip said the build was clean.
 *
 *  A counting loop in the preamble makes every build take over two
 *  seconds on two short chapters, which is what earns the scoping. */

type Done = { type: string; scope?: string; diagnostics?: { file?: string; severity?: string }[] };

test("an error in one chapter survives a build of another", async ({ app, project, page }) => {
  test.setTimeout(180_000);
  const root = project.root;
  mkdirSync(join(root, "chapters"), { recursive: true });
  writeFileSync(join(root, "main.tex"), [
    "\\documentclass{article}",
    "\\newcount\\slowN \\loop\\advance\\slowN by 1 \\ifnum\\slowN<9000000 \\repeat",
    "\\begin{document}",
    "\\include{chapters/00}",
    "\\include{chapters/01}",
    "\\end{document}",
    "",
  ].join("\n"));
  writeFileSync(join(root, "chapters", "00.tex"), "Chapter zero.\n");
  writeFileSync(join(root, "chapters", "01.tex"), "Chapter one.\n");

  const events = await watchEvents(app, project.id);
  const builds = () => events.payloads.filter((e) => e.type === "compile_done") as Done[];
  const errorsIn00 = (done: Done) =>
    (done.diagnostics ?? []).filter((d) => d.severity === "error" && d.file === "chapters/00.tex").length;
  const nextBuild = async (after: number) => {
    await expect.poll(() => builds().length, { timeout: 60_000 }).toBeGreaterThan(after);
    return builds()[builds().length - 1];
  };

  await page.goto(`${app.base}/?token=${app.token}`);
  await page.getByText("Projects", { exact: false }).first().waitFor();
  await openProject(page, root);
  await expect.poll(() => builds().length, { timeout: 60_000 }).toBeGreaterThan(0);

  // The error, typed into chapter 00. This build is a fast pass over the
  // whole document, which is what tells the scheduler a build is slow.
  await page.getByRole("treeitem", { name: /chapters/ }).click();
  await page.getByRole("treeitem", { name: /00\.tex/ }).click();
  await expect(page.locator(".cm-line", { hasText: "Chapter zero." })).toBeVisible();
  await page.locator(".cm-content").click();
  await page.keyboard.press("Control+End");
  let before = builds().length;
  await page.keyboard.type("\\undefinedcommandhere\n");
  let done = await nextBuild(before);
  while (errorsIn00(done) === 0) done = await nextBuild(builds().length);

  // A keystroke in chapter 01, whose build is scoped to it.
  await page.getByRole("treeitem", { name: /01\.tex/ }).click();
  await expect(page.locator(".cm-line", { hasText: "Chapter one." })).toBeVisible();
  await page.locator(".cm-content").click();
  await page.keyboard.press("Control+End");
  before = builds().length;
  await page.keyboard.type("More.\n");
  done = await nextBuild(before);
  while (done.scope === "full") done = await nextBuild(builds().length);

  expect(done.scope).toBe("chapters/01");
  expect(errorsIn00(done)).toBe(1);
  await expect(page.getByTestId("status")).toHaveAttribute("data-state", "errors");
  events.stop();
});
