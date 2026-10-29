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

test("errors from a build the file changed under are set apart, and not counted", async ({
  app, project, page,
}) => {
  // The thesis's writer pasted "File ended while scanning use of \revised"
  // from a build that ran while a brace was half deleted.  Compile as you
  // type is off, so the build after the edit waits for the writer and the
  // drawer can be read.
  test.setTimeout(120_000);
  const root = project.root;
  const headers = { "content-type": "application/json", "x-nexttex-token": app.token };
  await fetch(`${app.base}/api/projects/${project.id}/settings`, {
    method: "POST", headers, body: JSON.stringify({ autocompile: false }),
  });
  // TeX reads its input as it goes, so the half edit is in a part read
  // first, and the slow loop comes after it: the fix lands while the
  // engine is in the loop, having already met the open brace.
  writeFileSync(join(root, "main.tex"), [
    "\\documentclass{article}",
    "\\newcommand{\\revised}[1]{#1}",
    "\\begin{document}",
    "\\input{part}",
    "\\newcount\\slowN \\loop\\advance\\slowN by 1 \\ifnum\\slowN<12000000 \\repeat",
    "\\end{document}",
    "",
  ].join("\n"));
  writeFileSync(join(root, "part.tex"), "The rate \\revised{is\n");
  await page.goto(`${app.base}/?token=${app.token}`);
  await page.getByText("Projects", { exact: false }).first().waitFor();
  await openProject(page, root);
  await expect(page.getByTestId("status")).not.toHaveAttribute("data-state", "compiling", {
    timeout: 60_000,
  });
  const built = fetch(`${app.base}/api/projects/${project.id}/compile`, {
    method: "POST", headers, body: JSON.stringify({ full: false }),
  });
  await page.waitForTimeout(1500);
  writeFileSync(join(root, "part.tex"), "The rate \\revised{is} fast.\n");
  const payload = await (await built).json();
  expect(payload.transientErrors, JSON.stringify(payload.diagnostics)).toBeGreaterThan(0);

  const strip = page.getByTestId("status");
  await expect(strip).toHaveAttribute("data-state", "stale", { timeout: 20_000 });
  await strip.click();
  const group = page.getByTestId("build-transient");
  await expect(group).toContainText("The file changed while this was building");
  await expect(group).toContainText("File ended while scanning");
  await expect(group.getByTestId("diagnostic-fix")).toHaveCount(0);
});
