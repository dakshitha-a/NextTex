import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { test, expect, openProject } from "../fixtures";

/** Previewing more than one document.
 *
 *  A dissertation and its supplementary information are two documents in
 *  one folder and neither includes the other. Before this the only way to
 *  build the second was to make it the main file and change it back.
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

test("a standalone document is offered, and the strip appears once it is taken", async ({
  app, project, page,
}) => {
  await withEsi({ app, project, page });
  // One document is a label, not a strip: a single tab is a control that
  // controls nothing.
  await expect(page.getByTestId("preview-tab-main.tex")).toHaveCount(0);

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
  const main = await page.request.get(`${app.base}/api/projects/${project.id}/pdf`);
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

test("a document can be taken off the strip, and the main one cannot", async ({
  app, project, page,
}) => {
  await withEsi({ app, project, page });
  await page.getByTestId("add-preview").click();
  await page.getByRole("menuitem", { name: "esi.tex" }).click();
  await expect(page.getByTestId("preview-tab-esi.tex")).toBeVisible();

  // The main document has no close button at all -- a control that is
  // always refused is worse than no control.
  await expect(
    page.getByRole("button", { name: "Stop previewing main.tex" }),
  ).toHaveCount(0);

  await page.getByRole("button", { name: "Stop previewing esi.tex" }).click();
  await expect(page.getByTestId("preview-tab-esi.tex")).toHaveCount(0);
});

test("the choice survives a reload", async ({ app, project, page }) => {
  await withEsi({ app, project, page });
  await page.getByTestId("add-preview").click();
  await page.getByRole("menuitem", { name: "esi.tex" }).click();
  await expect(page.getByTestId("preview-tab-esi.tex")).toBeVisible();

  await page.reload();
  await expect(page.locator(".cm-editor")).toBeVisible({ timeout: 30_000 });
  // It is in nexttex.toml, not in this tab's memory.
  await expect(page.getByTestId("preview-tab-esi.tex")).toBeVisible({
    timeout: 20_000,
  });
});
