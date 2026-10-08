import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test, expect, openFolders, openProject } from "../fixtures";

/** Any file whose bytes are text opens in the source editor.
 *
 *  The editor used to open a file only when its suffix was on a list of
 *  eighteen, so a molecule's `.xyz`, a Gaussian input and a Fortran source
 *  were each offered as a download. The server now reads the head of a
 *  file it has no name for and calls it text when it is; a binary under a
 *  name nobody lists is still a download.
 */

const FILES: Record<string, string> = {
  "geom/benzene.xyz": "12\nbenzene\nC 0.000000 1.396792 0.000000\n",
  "calc/water.gjf": "%mem=4GB\n# B3LYP/6-31G(d) opt\n\nwater\n\n0 1\nO 0.0 0.0 0.0\n",
  "src/integrals.f90": "program integrals\n  implicit none\n  integer :: n\nend program integrals\n",
};

async function open(page: any, app: any, project: any) {
  for (const [name, body] of Object.entries(FILES)) {
    mkdirSync(join(project.root, name, ".."), { recursive: true });
    writeFileSync(join(project.root, name), body);
  }
  mkdirSync(join(project.root, "calc"), { recursive: true });
  writeFileSync(join(project.root, "calc", "water.gbw2"), Buffer.from(Array.from({ length: 512 }, (_, i) => i % 256)));
  await page.goto(`${app.base}/?token=${app.token}`);
  await page.getByText("Projects", { exact: false }).first().waitFor();
  await openProject(page, project.root);
}

async function click(page: any, path: string) {
  await openFolders(page, path);
  await page.locator(`[role="tree"] [data-path="${path}"]`).click();
}

test("a molecule, a program's input and a Fortran source open in the editor", async ({
  app, project, page,
}) => {
  await open(page, app, project);

  await click(page, "geom/benzene.xyz");
  await expect(page.locator(".cm-content")).toContainText("C 0.000000 1.396792", { timeout: 15_000 });
  await expect(page.getByTestId("file-view")).toHaveCount(0);

  // A program's input is plain text: LaTeX's mode drew `%mem=4GB` as a
  // comment, which it is not.
  await click(page, "calc/water.gjf");
  await expect(page.locator(".cm-content")).toContainText("# B3LYP/6-31G(d) opt", { timeout: 15_000 });
  const first = page.locator(".cm-line").first();
  await expect(first).toHaveText("%mem=4GB");
  await expect(first.locator("span")).toHaveCount(0);

  // A source file is drawn in its own language, fetched when it is first
  // wanted: the keyword is a highlighted span of its own.
  await click(page, "src/integrals.f90");
  await expect(page.locator(".cm-content")).toContainText("implicit none", { timeout: 15_000 });
  await expect(page.locator(".cm-line span", { hasText: /^program$/ }).first()).toBeVisible();

  // And it is live: what is typed reaches the file on disk.
  await page.locator(".cm-content").click();
  await page.keyboard.press("Control+End");
  await page.keyboard.type("! integrals of a water molecule");
  await expect
    .poll(() => readFileSync(join(project.root, "src", "integrals.f90"), "utf-8"), { timeout: 15_000 })
    .toContain("! integrals of a water molecule");
});

test("a binary under a name nobody lists is offered as a download", async ({
  app, project, page,
}) => {
  await open(page, app, project);
  await click(page, "calc/water.gbw2");
  await expect(page.getByTestId("file-view")).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId("file-view")).toContainText("Download");
});

/** A program's output is often megabytes long.
 *
 *  Past the size a shared document may be, the editor bound to nothing and
 *  showed an empty page marked offline, which kept nothing typed into it.
 *  Now such a file is read, and said to be; past what the file route hands
 *  over at all, it is a download that says why.
 */
const LINE = "SCF Done:  E(RB3LYP) =  -76.4089533     A.U. after   10 cycles\n";

test("a large output opens for reading, and a larger one says it is too large", async ({
  app, project, page,
}) => {
  writeFileSync(join(project.root, "large.out"), LINE.repeat(Math.ceil((3 << 20) / LINE.length)));
  writeFileSync(join(project.root, "huge.out"), LINE.repeat(Math.ceil((12 << 20) / LINE.length)));
  await open(page, app, project);

  await click(page, "large.out");
  await expect(page.locator(".cm-content")).toContainText("SCF Done:", { timeout: 15_000 });
  await expect(page.getByText(/large\.out is 3\.0 MB, so it is open for reading only/)).toBeVisible();
  await expect(page.locator(".cm-content")).toHaveAttribute("contenteditable", "false");

  await click(page, "huge.out");
  await expect(page.getByTestId("file-view")).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId("file-view-too-large")).toContainText("Too large to open here");
});
