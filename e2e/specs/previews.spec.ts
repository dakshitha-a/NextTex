import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test, expect, openFolders, openProject } from "../fixtures";

/** Previewing more than one document.
 *
 *  A dissertation and its supplementary information are two documents in
 *  one folder and neither includes the other.  There is no main document:
 *  every root .tex is one, and the page follows the file being written to
 *  the document that reads it.
 */

const STANDALONE = `\\documentclass{article}
\\begin{document}
Supplementary information.
\\end{document}
`;

/** Seed a standalone document and open the project on it. */
async function withEsi({ app, project, page }: any) {
  writeFileSync(join(project.root, "esi.tex"), STANDALONE);
  await page.goto(`${app.base}/?token=${app.token}`);
  await page.getByText("Projects", { exact: false }).first().waitFor();
  await openProject(page, project.root);
  await expect(page.locator(".cm-editor")).toBeVisible({ timeout: 30_000 });
}

test("a standalone document is offered, and joins the strip once it is taken", async ({
  app, project, page,
}) => {
  await withEsi({ app, project, page });
  // One document is one tab, drawn all the same: the tab in front is the
  // pane's handle, and a label is not a handle.  Alone, it cannot close.
  await expect(page.getByTestId("preview-tab-main.tex")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Stop previewing main.tex" }),
  ).toHaveCount(0);

  await page.getByTestId("add-preview").click();
  await page.getByRole("menuitem", { name: "esi.tex" }).click();

  await expect(page.getByTestId("preview-tab-main.tex")).toBeVisible();
  await expect(page.getByTestId("preview-tab-esi.tex")).toBeVisible();
});

test("a chapter is never offered as a document of its own", async ({
  app, project, page,
}) => {
  writeFileSync(join(project.root, "chapter.tex"), "A chapter with no preamble.\n");
  await page.goto(`${app.base}/?token=${app.token}`);
  await page.getByText("Projects", { exact: false }).first().waitFor();
  await openProject(page, project.root);
  await expect(page.locator(".cm-editor")).toBeVisible({ timeout: 30_000 });
  // Nothing to add, so no control to add it with.
  await expect(page.getByTestId("add-preview")).toHaveCount(0);
});

test("both documents build, and each keeps its own page", async ({
  app, project, page,
}) => {
  await withEsi({ app, project, page });
  await page.getByTestId("add-preview").click();
  await page.getByRole("menuitem", { name: "esi.tex" }).click();

  // Each tab settles on its own build rather than sharing one status.
  await expect(page.getByTestId("preview-tab-esi.tex")).toBeVisible();
  await expect(page.locator("canvas").first()).toBeVisible({ timeout: 60_000 });

  // Two PDFs on disk, one per document -- the jobname is what keeps them
  // apart, and a shared one would have each serving the other's page.
  await expect
    .poll(
      async () =>
        (await page.request.get(`${app.base}/api/projects/${project.id}/pdf?document=esi.tex`))
          .status(),
      { timeout: 60_000 },
    )
    .toBe(200);
  const main = await page.request.get(
    `${app.base}/api/projects/${project.id}/pdf?document=main.tex`,
  );
  const esi = await page.request.get(
    `${app.base}/api/projects/${project.id}/pdf?document=esi.tex`,
  );
  expect(main.headers()["etag"]).not.toBe(esi.headers()["etag"]);
});

test("the preview follows the file you open, and the file follows the tab", async ({
  app, project, page,
}) => {
  await withEsi({ app, project, page });
  await page.getByTestId("add-preview").click();
  await page.getByRole("menuitem", { name: "esi.tex" }).click();
  // Adding it brings it forward and opens its source.
  await expect(page.getByTestId("preview-tab-esi.tex")).toHaveAttribute(
    "aria-current", "true",
  );

  // Clicking the other tab opens the other source.
  await page.getByTestId("preview-tab-main.tex").click();
  await expect(page.getByTestId("preview-tab-main.tex")).toHaveAttribute(
    "aria-current", "true",
  );
  await expect(
    page.locator('[data-tab] button[aria-current="true"]'),
  ).toContainText("main");
});

test("the shortcut cycles the previewed documents", async ({
  app, project, page,
}) => {
  await withEsi({ app, project, page });
  await page.getByTestId("add-preview").click();
  await page.getByRole("menuitem", { name: "esi.tex" }).click();
  await expect(page.getByTestId("preview-tab-esi.tex")).toHaveAttribute(
    "aria-current", "true",
  );

  await page.keyboard.press("Control+Alt+KeyP");
  await expect(page.getByTestId("preview-tab-main.tex")).toHaveAttribute(
    "aria-current", "true",
  );
  await page.keyboard.press("Control+Alt+KeyP");
  await expect(page.getByTestId("preview-tab-esi.tex")).toHaveAttribute(
    "aria-current", "true",
  );
});

test("any document can be taken off the strip, but not the last one", async ({
  app, project, page,
}) => {
  await withEsi({ app, project, page });
  await page.getByTestId("add-preview").click();
  await page.getByRole("menuitem", { name: "esi.tex" }).click();
  await expect(page.getByTestId("preview-tab-esi.tex")).toBeVisible();

  // The document that used to be "main" is a document like any other, and
  // its file goes with it; esi.tex, opened by the add, stays.
  await page.getByRole("button", { name: "Stop previewing main.tex" }).click();
  await expect(page.getByTestId("preview-tab-main.tex")).toHaveCount(0);
  await expect(page.locator('[data-tab][data-path="main.tex"]')).toHaveCount(0);
  await expect(page.locator('[data-tab][data-path="esi.tex"]')).toHaveCount(1);
  // The last one has no close button at all: a control that is always
  // refused is worse than no control.
  await expect(
    page.getByRole("button", { name: "Stop previewing esi.tex" }),
  ).toHaveCount(0);
});

test("opening a chapter previews the document that reads it, however deep", async ({
  app, project, page,
}) => {
  // esi.tex reads parts/one.tex, which reads parts/two.tex.  Opening the
  // deepest file puts esi on the strip and in front, without opening
  // esi.tex itself on the source strip.
  mkdirSync(join(project.root, "parts"), { recursive: true });
  writeFileSync(
    join(project.root, "esi.tex"),
    "\\documentclass{article}\n\\begin{document}\n\\input{parts/one}\n\\end{document}\n",
  );
  writeFileSync(join(project.root, "parts", "one.tex"), "\\input{two}\nOne.\n");
  writeFileSync(join(project.root, "parts", "two.tex"), "Two.\n");
  await page.goto(`${app.base}/?token=${app.token}`);
  await page.getByText("Projects", { exact: false }).first().waitFor();
  await openProject(page, project.root);
  await expect(page.locator(".cm-editor")).toBeVisible({ timeout: 30_000 });

  await openFolders(page, "parts/two.tex");
  await page.locator('[role="tree"] [data-path="parts/two.tex"]').click();
  await expect(page.getByTestId("preview-tab-esi.tex")).toHaveAttribute(
    "aria-current", "true", { timeout: 15_000 },
  );
  await expect(page.locator('[data-tab][data-path="esi.tex"]')).toHaveCount(0);
  await expect(
    page.locator('[data-tab][data-path="parts/two.tex"] button[aria-current="true"]'),
  ).toBeVisible();

  // Back to a file of the other document, and the page follows again.
  await page.locator('[role="tree"] [data-path="main.tex"]').click();
  await expect(page.getByTestId("preview-tab-main.tex")).toHaveAttribute(
    "aria-current", "true",
  );
});

test("a fragment nothing reads leaves the preview where it was", async ({
  app, project, page,
}) => {
  writeFileSync(join(project.root, "scratch.tex"), "Notes, not part of anything.\n");
  await withEsi({ app, project, page });
  await page.getByTestId("add-preview").click();
  await page.getByRole("menuitem", { name: "esi.tex" }).click();
  await expect(page.getByTestId("preview-tab-esi.tex")).toHaveAttribute(
    "aria-current", "true",
  );
  await page.locator('[role="tree"] [data-path="scratch.tex"]').click();
  await expect(
    page.locator('[data-tab][data-path="scratch.tex"] button[aria-current="true"]'),
  ).toBeVisible();
  await expect(page.getByTestId("preview-tab-esi.tex")).toHaveAttribute(
    "aria-current", "true",
  );
});

test("the choice survives a reload", async ({ app, project, page }) => {
  await withEsi({ app, project, page });
  await page.getByTestId("add-preview").click();
  await page.getByRole("menuitem", { name: "esi.tex" }).click();
  await expect(page.getByTestId("preview-tab-esi.tex")).toBeVisible();

  await page.reload();
  await expect(page.locator(".cm-editor")).toBeVisible({ timeout: 30_000 });
  // It is in .nexttex/previews.json, not in this tab's memory.
  await expect(page.getByTestId("preview-tab-esi.tex")).toBeVisible({
    timeout: 20_000,
  });
});

test("the documents can be changed with a mouse below 900px", async ({
  app, project, page,
}) => {
  // There is no preview header at this width, so the strip shares the row
  // with the source/preview toggle.  Without it the only way to change
  // document was the keyboard.
  await withEsi({ app, project, page });
  await page.getByTestId("add-preview").click();
  await page.getByRole("menuitem", { name: "esi.tex" }).click();
  await expect(page.getByTestId("preview-tab-esi.tex")).toBeVisible();

  await page.setViewportSize({ width: 800, height: 900 });
  await page.getByRole("button", { name: "Preview" }).first().click();
  await expect(page.getByTestId("preview-tab-main.tex")).toBeVisible();
  await page.getByTestId("preview-tab-main.tex").click();
  await expect(page.getByTestId("preview-tab-main.tex")).toHaveAttribute(
    "aria-current", "true",
  );
});
