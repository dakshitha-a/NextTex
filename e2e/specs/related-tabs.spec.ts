import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test, expect, openFolders, openProject } from "../fixtures";

/** The two strips move together.
 *
 *  Stopping a preview closes the files of that document, and a document
 *  the strip got only because one of its files was opened leaves again
 *  when its last file does. The arithmetic is `orphanedBy` and
 *  `unfollowed` in `frontend/src/tabs.ts`, with their own vitest; what only
 *  a browser can say is that the gestures reach them, that the server's
 *  refusal of the last document leaves the source strip alone, and that
 *  the reopen shortcut brings both a file and its document back.
 *
 *  The project: `main.tex` from the template, which reads `shared.tex`;
 *  `esi.tex`, which reads `parts/one.tex`, which reads `parts/two.tex`,
 *  and `shared.tex` as well; and `scratch.tex`, which nothing reads.
 */

const ESI = `\\documentclass{article}
\\begin{document}
\\input{parts/one}
\\input{shared}
\\end{document}
`;

async function withParts({ app, project, page }: any) {
  mkdirSync(join(project.root, "parts"), { recursive: true });
  writeFileSync(join(project.root, "esi.tex"), ESI);
  writeFileSync(join(project.root, "parts", "one.tex"), "\\input{two}\nOne.\n");
  writeFileSync(join(project.root, "parts", "two.tex"), "Two.\n");
  writeFileSync(join(project.root, "shared.tex"), "Shared between both.\n");
  writeFileSync(join(project.root, "scratch.tex"), "Notes, not part of anything.\n");
  const main = join(project.root, "main.tex");
  writeFileSync(
    main,
    readFileSync(main, "utf8").replace("\\end{document}", "\\input{shared}\n\\end{document}"),
  );
  await page.goto(`${app.base}/?token=${app.token}`);
  await page.getByText("Projects", { exact: false }).first().waitFor();
  await openProject(page, project.root);
  await expect(page.locator(".cm-editor")).toBeVisible({ timeout: 30_000 });
}

const sourceTab = (page: any, path: string) => page.locator(`[data-tab][data-path="${path}"]`);

/** Open a file from the tree, and wait for it to be the tab in front. */
async function openFromTree(page: any, path: string) {
  await openFolders(page, path);
  await page.locator(`[role="tree"] [data-path="${path}"]`).click();
  await expect(
    page.locator(`[data-tab][data-path="${path}"] button[aria-current="true"]`),
  ).toBeVisible({ timeout: 15_000 });
}

test("stopping a preview closes that document's files and keeps everyone else's", async ({
  app, project, page,
}) => {
  await withParts({ app, project, page });
  // The deepest part brings esi onto the strip and in front.
  await openFromTree(page, "parts/two.tex");
  await expect(page.getByTestId("preview-tab-esi.tex")).toHaveAttribute(
    "aria-current", "true", { timeout: 15_000 },
  );
  // A file both documents read, and one nothing reads.
  await openFromTree(page, "shared.tex");
  await openFromTree(page, "scratch.tex");
  await expect(page.locator("[data-tab]")).toHaveCount(4);

  await page.getByRole("button", { name: "Stop previewing esi.tex" }).click();
  await expect(page.getByTestId("preview-tab-esi.tex")).toHaveCount(0);
  // The chapter went with its document; the shared file still belongs to
  // main, the scratch file belongs to nothing, and neither is touched.
  await expect(sourceTab(page, "parts/two.tex")).toHaveCount(0);
  await expect(sourceTab(page, "shared.tex")).toHaveCount(1);
  await expect(sourceTab(page, "scratch.tex")).toHaveCount(1);
  await expect(sourceTab(page, "main.tex")).toHaveCount(1);
  // The tab in front was not among them, so it is still in front.
  await expect(
    page.locator('[data-tab][data-path="scratch.tex"] button[aria-current="true"]'),
  ).toBeVisible();
});

test("the reopen shortcut brings the file back, and its document with it", async ({
  app, project, page,
}) => {
  await withParts({ app, project, page });
  await openFromTree(page, "parts/two.tex");
  await expect(page.getByTestId("preview-tab-esi.tex")).toBeVisible({ timeout: 15_000 });
  await page.getByRole("button", { name: "Stop previewing esi.tex" }).click();
  await expect(sourceTab(page, "parts/two.tex")).toHaveCount(0);
  await expect(page.getByTestId("preview-tab-esi.tex")).toHaveCount(0);

  await page.keyboard.press("Control+Alt+Shift+T");
  await expect(sourceTab(page, "parts/two.tex")).toBeVisible({ timeout: 10_000 });
  // The page follows the file, as it did the first time.
  await expect(page.getByTestId("preview-tab-esi.tex")).toHaveAttribute(
    "aria-current", "true", { timeout: 15_000 },
  );
});

test("stopping the others closes their files in one go", async ({
  app, project, page,
}) => {
  await withParts({ app, project, page });
  // Added by name, which opens its own file on the source strip.
  await page.getByTestId("add-preview").click();
  await page.getByRole("menuitem", { name: "esi.tex" }).click();
  await expect(sourceTab(page, "esi.tex")).toBeVisible({ timeout: 15_000 });
  await openFromTree(page, "parts/two.tex");
  await expect(page.locator("[data-tab]")).toHaveCount(3);

  await page.locator('[data-preview-tab][data-path="main.tex"]').click();
  await page.locator('[data-preview-tab][data-path="main.tex"]').click({ button: "right" });
  await page.getByRole("menuitem", { name: "Stop previewing the others" }).click();
  await expect(page.locator("[data-preview-tab]")).toHaveCount(1);
  await expect(sourceTab(page, "esi.tex")).toHaveCount(0);
  await expect(sourceTab(page, "parts/two.tex")).toHaveCount(0);
  await expect(sourceTab(page, "main.tex")).toHaveCount(1);
});

test("a document the strip got by following a file leaves with it", async ({
  app, project, page,
}) => {
  await withParts({ app, project, page });
  await openFromTree(page, "parts/two.tex");
  await expect(page.getByTestId("preview-tab-esi.tex")).toHaveAttribute(
    "aria-current", "true", { timeout: 15_000 },
  );
  await openFromTree(page, "main.tex");
  await expect(page.getByTestId("preview-tab-main.tex")).toHaveAttribute(
    "aria-current", "true",
  );

  await page.getByRole("button", { name: "Close two.tex" }).click();
  await expect(sourceTab(page, "parts/two.tex")).toHaveCount(0);
  // Nobody asked for esi by name; the chapter brought it and the chapter
  // has gone.
  await expect(page.getByTestId("preview-tab-esi.tex")).toHaveCount(0, { timeout: 10_000 });
  await expect(page.getByTestId("preview-tab-main.tex")).toHaveAttribute(
    "aria-current", "true",
  );

  // And the way back is the same as for any closed tab.
  await page.keyboard.press("Control+Alt+Shift+T");
  await expect(sourceTab(page, "parts/two.tex")).toBeVisible({ timeout: 10_000 });
  await expect(page.getByTestId("preview-tab-esi.tex")).toHaveAttribute(
    "aria-current", "true", { timeout: 15_000 },
  );
});

test("a followed document is still followed after a reload", async ({
  app, project, page,
}) => {
  // The memory of what this window followed was browser memory, empty
  // after a reload, so every document on the strip then read as asked
  // for and closing the chapter that brought one there left it.  It is
  // the window's session storage now: a reload keeps it, another window
  // never sees it, and no stored format changed.
  await withParts({ app, project, page });
  await openFromTree(page, "parts/two.tex");
  await expect(page.getByTestId("preview-tab-esi.tex")).toHaveAttribute(
    "aria-current", "true", { timeout: 15_000 },
  );
  await openFromTree(page, "main.tex");
  await expect(page.getByTestId("preview-tab-main.tex")).toHaveAttribute(
    "aria-current", "true",
  );

  await page.reload();
  await expect(sourceTab(page, "parts/two.tex")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("preview-tab-esi.tex")).toBeVisible({ timeout: 15_000 });

  await page.getByRole("button", { name: "Close two.tex" }).click();
  await expect(sourceTab(page, "parts/two.tex")).toHaveCount(0);
  await expect(page.getByTestId("preview-tab-esi.tex")).toHaveCount(0, { timeout: 10_000 });
});

test("a document added by name stays when its file closes", async ({
  app, project, page,
}) => {
  await withParts({ app, project, page });
  await page.getByTestId("add-preview").click();
  await page.getByRole("menuitem", { name: "esi.tex" }).click();
  await expect(sourceTab(page, "esi.tex")).toBeVisible({ timeout: 15_000 });

  await page.getByRole("button", { name: "Close esi.tex" }).click();
  await expect(sourceTab(page, "esi.tex")).toHaveCount(0);
  await expect(page.locator("[data-tab]")).toHaveCount(1);
  // Asked for with +, so it is the writer's to take away, not the tab's.
  await page.waitForTimeout(500);
  await expect(page.getByTestId("preview-tab-esi.tex")).toBeVisible();
});

test("a followed document the writer then clicked on stays", async ({
  app, project, page,
}) => {
  await withParts({ app, project, page });
  await openFromTree(page, "parts/two.tex");
  await expect(page.getByTestId("preview-tab-esi.tex")).toBeVisible({ timeout: 15_000 });
  await openFromTree(page, "main.tex");
  // A click on its tab is asking for it, and opens its own file.
  await page.locator('[data-preview-tab][data-path="esi.tex"]').click();
  await expect(sourceTab(page, "esi.tex")).toBeVisible({ timeout: 15_000 });

  await page.getByRole("button", { name: "Close esi.tex" }).click();
  await page.getByRole("button", { name: "Close two.tex" }).click();
  await expect(page.locator("[data-tab]")).toHaveCount(1);
  await page.waitForTimeout(500);
  await expect(page.getByTestId("preview-tab-esi.tex")).toBeVisible();
});

test("the last document stays even when every file of it is closed", async ({
  app, project, page,
}) => {
  await withParts({ app, project, page });
  await openFromTree(page, "parts/two.tex");
  await expect(page.getByTestId("preview-tab-esi.tex")).toBeVisible({ timeout: 15_000 });
  // main goes, and its file with it; esi is now the only document.
  await page.getByRole("button", { name: "Stop previewing main.tex" }).click();
  await expect(sourceTab(page, "main.tex")).toHaveCount(0);
  await expect(page.locator("[data-preview-tab]")).toHaveCount(1);

  await page.getByRole("button", { name: "Close two.tex" }).click();
  await expect(page.locator("[data-tab]")).toHaveCount(0);
  // The strip cannot be emptied, so the page keeps the one it has.
  await page.waitForTimeout(500);
  await expect(page.getByTestId("preview-tab-esi.tex")).toBeVisible();
});
