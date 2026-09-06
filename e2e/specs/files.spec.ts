import { test, expect } from "../fixtures";
import type { Page } from "@playwright/test";

/** Making files, and putting files in.
 *
 *  Every file operation used to hang off a row's menu, which meant there
 *  had to *be* a row: a new project holds one empty document, so its first
 *  folder could only be made by opening the menu on main.tex and knowing
 *  that "New folder here" resolves to the folder holding it.  These specs
 *  are mostly about that hole being closed, and about the one thing an
 *  upload must never do again -- overwrite a figure with no way back.
 */

/** A one-pixel PNG, so an upload is a real image rather than bytes with an
 *  optimistic name. */
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

async function put(page: Page, base: string, token: string, id: string, path: string) {
  await page.evaluate(
    async ({ base, token, id, path }) => {
      await fetch(`${base}/api/projects/${id}/file`, {
        method: "PUT",
        headers: { "content-type": "application/json", "x-nexttex-token": token },
        body: JSON.stringify({ path, text: "x\n", compile: false, create: true }),
      });
    },
    { base, token, id, path },
  );
}

test("a new file can be made without there being a row to hang it off", async ({
  tab,
}) => {
  await tab.getByTestId("new-file").click();
  await tab.keyboard.type("results");
  await tab.keyboard.press("Enter");

  // Named without an extension, so it gets the one a LaTeX writer meant.
  await expect(tab.locator('[data-tab][data-path="results.tex"]')).toBeVisible({
    timeout: 15_000,
  });
  // And it opens, because a new .tex file exists to be typed into.
  await expect(
    tab.locator('[data-tab][data-path="results.tex"] button[aria-current]'),
  ).toBeVisible();
});

test("a name that cannot work says so where it was typed", async ({ tab }) => {
  await tab.getByTestId("new-file").click();
  await tab.keyboard.type("chapters/three");
  await tab.keyboard.press("Enter");
  await expect(tab.getByText("A name cannot contain a slash.")).toBeVisible();
  // Still there to be corrected, rather than thrown away with a message at
  // the other end of the app.
  await tab.keyboard.press("Escape");
});

test("a name already taken says so, and keeps what was typed", async ({ tab }) => {
  await tab.getByTestId("new-file").click();
  await tab.keyboard.type("main.tex");
  await tab.keyboard.press("Enter");
  await expect(tab.getByText(/There is already a main\.tex here\./)).toBeVisible({
    timeout: 15_000,
  });
});

test("a new folder can be made at the project root", async ({ tab }) => {
  await tab.getByTestId("new-folder").click();
  await tab.keyboard.type("appendices");
  await tab.keyboard.press("Enter");
  await expect(
    tab.getByRole("treeitem", { name: /appendices/ }).first(),
  ).toBeVisible({ timeout: 15_000 });
});

test("uploading asks where, and remembers the answer next time", async ({ tab }) => {
  const chooser = tab.getByTestId("upload-staging");

  await tab.getByTestId("upload").click();
  const picked = tab.locator('input[type="file"]');
  await picked.setInputFiles({ name: "plot.png", mimeType: "image/png", buffer: PNG });

  await expect(chooser).toBeVisible({ timeout: 10_000 });
  await expect(chooser).toContainText("Upload plot.png");
  await chooser.getByRole("button", { name: /Into/ }).click();
  await chooser.getByRole("option", { name: "figures" }).click();
  await chooser.getByRole("button", { name: "Upload", exact: true }).click();

  await expect(chooser).toHaveCount(0, { timeout: 15_000 });
  await expect(
    tab.getByRole("treeitem", { name: /plot\.png/ }).first(),
  ).toBeVisible({ timeout: 15_000 });

  // Second time it opens on the folder the first one went to.
  await tab.getByTestId("upload").click();
  await picked.setInputFiles({ name: "other.png", mimeType: "image/png", buffer: PNG });
  await expect(chooser).toBeVisible({ timeout: 10_000 });
  await expect(chooser.getByRole("button", { name: /Into/ })).toContainText(
    "figures",
  );
});

test("a name already there is asked about before anything is written", async ({
  app, project, tab,
}) => {
  await put(tab, app.base, app.token, project.id, "figures/plot.png");
  await expect(
    tab.getByRole("treeitem", { name: /plot\.png/ }).first(),
  ).toBeVisible({ timeout: 15_000 });

  await tab.getByTestId("upload").click();
  await tab
    .locator('input[type="file"]')
    .setInputFiles({ name: "plot.png", mimeType: "image/png", buffer: PNG });

  const chooser = tab.getByTestId("upload-staging");
  await expect(chooser).toBeVisible({ timeout: 10_000 });
  await chooser.getByRole("button", { name: /Into/ }).click();
  await chooser.getByRole("option", { name: "figures" }).click();

  await expect(chooser.getByText("1 file is already there.")).toBeVisible();
  // Replace is the default, because re-exporting a figure is the case, and
  // it is only safe as a default because what it replaces is kept.
  await expect(
    chooser.getByRole("button", { name: "Replace" }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(
    chooser.getByText("What it replaces stays in that file's history."),
  ).toBeVisible();

  await chooser.getByRole("button", { name: "Keep both" }).click();
  await expect(
    chooser.getByText("The new one comes in as plot (2).png."),
  ).toBeVisible();
  await chooser.getByRole("button", { name: "Upload", exact: true }).click();

  await expect(
    tab.getByRole("treeitem", { name: /plot \(2\)\.png/ }).first(),
  ).toBeVisible({ timeout: 15_000 });
});

test("cancelling the chooser writes nothing", async ({ tab }) => {
  await tab.getByTestId("upload").click();
  await tab
    .locator('input[type="file"]')
    .setInputFiles({ name: "unwanted.png", mimeType: "image/png", buffer: PNG });

  const chooser = tab.getByTestId("upload-staging");
  await expect(chooser).toBeVisible({ timeout: 10_000 });
  await tab.keyboard.press("Escape");
  await expect(chooser).toHaveCount(0);
  await expect(tab.getByRole("treeitem", { name: /unwanted\.png/ })).toHaveCount(0);
});

test("a replaced figure keeps the one it replaced, and gives it back", async ({
  app, project, tab,
}) => {
  // The bug this whole path exists for: dropping a corrected plot over an
  // old one used to destroy the old one outright.
  await tab.getByTestId("upload").click();
  const picked = tab.locator('input[type="file"]');
  await picked.setInputFiles({ name: "plot.png", mimeType: "image/png", buffer: PNG });
  const chooser = tab.getByTestId("upload-staging");
  await expect(chooser).toBeVisible({ timeout: 10_000 });
  await chooser.getByRole("button", { name: "Upload", exact: true }).click();
  await expect(chooser).toHaveCount(0, { timeout: 15_000 });

  await tab.getByTestId("upload").click();
  await picked.setInputFiles({
    name: "plot.png",
    mimeType: "image/png",
    buffer: Buffer.concat([PNG, Buffer.from("a different figure")]),
  });
  await expect(chooser).toBeVisible({ timeout: 10_000 });
  await expect(chooser.getByText("1 file is already there.")).toBeVisible();
  await chooser.getByRole("button", { name: "Upload", exact: true }).click();
  await expect(chooser).toHaveCount(0, { timeout: 15_000 });

  // A figure is a document like any other: it opens, and it has a history.
  await tab.getByRole("treeitem", { name: /plot\.png/ }).first().click();
  await expect(tab.getByTestId("file-view")).toBeVisible({ timeout: 15_000 });

  await tab.getByLabel("Actions for plot.png").click();
  await tab.getByRole("tree").getByRole("button", { name: "History" }).click();
  await expect(tab.getByTestId("version").first()).toBeVisible({ timeout: 15_000 });

  await tab.getByTestId("version").first().click();
  const open = tab.getByTestId("version-open").first();
  await expect(open).toBeVisible();
  await open.getByRole("button", { name: "Restore this" }).click();
  await open.getByRole("button", { name: "Restore", exact: true }).click();

  await expect
    .poll(
      async () => {
        const answer = await fetch(
          `${app.base}/api/projects/${project.id}/file?path=figures/plot.png`,
          { headers: { "x-nexttex-token": app.token } },
        );
        return answer.status;
      },
      { timeout: 15_000 },
    )
    .toBeLessThan(500);
});

test("a file can be moved into another folder", async ({ tab }) => {
  await tab.getByTestId("new-folder").click();
  await tab.keyboard.type("appendices");
  await tab.keyboard.press("Enter");
  await expect(
    tab.getByRole("treeitem", { name: /appendices/ }).first(),
  ).toBeVisible({ timeout: 15_000 });

  await tab.getByLabel("Actions for references.bib").click();
  await tab.getByRole("button", { name: "Move to…" }).click();

  const dialog = tab.getByTestId("move-to");
  await expect(dialog).toBeVisible();
  await dialog.getByRole("option", { name: "appendices" }).click();
  await dialog.getByRole("button", { name: "Move", exact: true }).click();

  await expect(
    row(tab, "appendices/references.bib"),
  ).toBeVisible({ timeout: 15_000 });
});

test("typing in the tree jumps to a file", async ({ tab }) => {
  // Kept as the keyboard path now that there is also a filter box.
  await tab.getByRole("treeitem", { name: /main\.tex/ }).first().click();
  await tab.keyboard.press("r");
  await expect(row(tab, "references.bib")).toBeFocused();
});


/** A row in the file list.  Tabs carry `data-path` too, so a bare selector
 *  matches the open file twice and means neither. */
const row = (tab: Page, path: string) =>
  tab.locator(`[role="tree"] [data-path="${path}"]`);

/** Drag one row onto another.
 *
 *  The events are dispatched rather than mimed with the mouse.  Chromium,
 *  driven headlessly, raises `dragstart` and `dragover` for a real pointer
 *  drag and then ends it with `dragend` instead of `drop`, so a mouse-driven
 *  version of this passes only when the feature is broken.  What is under
 *  test is what the tree does with the drop, and that is exercised here in
 *  full: the same handlers, the same DataTransfer, the same server call.
 *  That Chromium starts the drag at all is checked by hand in a real
 *  browser instead. */
async function dragRow(tab: Page, from: string, onto: string): Promise<void> {
  await tab.evaluate(
    ({ from, onto }) => {
      const at = (path: string) =>
        document.querySelector(`[role="tree"] [data-path="${path}"]`)!;
      const data = new DataTransfer();
      at(from).dispatchEvent(
        new DragEvent("dragstart", { bubbles: true, dataTransfer: data }),
      );
      const target = at(onto);
      target.dispatchEvent(
        new DragEvent("dragover", { bubbles: true, dataTransfer: data }),
      );
      target.dispatchEvent(
        new DragEvent("drop", { bubbles: true, dataTransfer: data }),
      );
    },
    { from, onto },
  );
}

test("the file list can be searched, and clearing it gives the tree back", async ({
  app, project, tab,
}) => {
  await put(tab, app.base, app.token, project.id, "chapters/02_theory.tex");
  await put(tab, app.base, app.token, project.id, "chapters/03_results.tex");
  await expect(row(tab, "chapters")).toBeVisible({
    timeout: 15_000,
  });

  // Collapse a folder first: clearing the search has to give this back
  // rather than leaving the tree unfolded on the writer's behalf.
  await row(tab, "chapters").click();
  await expect(row(tab, "chapters/02_theory.tex")).toBeHidden();

  await tab.getByTestId("file-search-open").click();
  await tab.getByTestId("file-search").fill("theory");

  // The match is shown, through a folder that is collapsed, and the file
  // that does not match is not.
  await expect(row(tab, "chapters/02_theory.tex")).toBeVisible();
  await expect(row(tab, "chapters/03_results.tex")).toBeHidden();
  await expect(row(tab, "main.tex")).toBeHidden();

  await tab.getByTestId("file-search").press("Escape");
  await expect(row(tab, "main.tex")).toBeVisible();
  // Still collapsed, exactly as it was left.
  await expect(row(tab, "chapters/02_theory.tex")).toBeHidden();
});

test("a search that finds nothing says so", async ({ tab }) => {
  await tab.getByTestId("file-search-open").click();
  await tab.getByTestId("file-search").fill("zzzz");
  await expect(tab.getByTestId("no-matches")).toContainText("zzzz");
});

test("a file can be dragged into a folder", async ({ tab }) => {
  await tab.getByTestId("new-folder").click();
  await tab.keyboard.type("appendices");
  await tab.keyboard.press("Enter");
  await expect(row(tab, "appendices")).toBeVisible({
    timeout: 15_000,
  });

  await dragRow(tab, "references.bib", "appendices");

  await expect(row(tab, "appendices/references.bib")).toBeVisible({
    timeout: 15_000,
  });
  await expect(row(tab, "references.bib")).toBeHidden();
});

test("a folder dragged into itself is refused, and nothing moves", async ({
  app, project, tab,
}) => {
  await put(tab, app.base, app.token, project.id, "chapters/figures/plot.tex");
  await expect(row(tab, "chapters")).toBeVisible({
    timeout: 15_000,
  });
  await expect(row(tab, "chapters/figures")).toBeVisible();

  await dragRow(tab, "chapters", "chapters/figures");

  // Still where it was, and no error strip: an illegal drop is refused
  // while it is being dragged rather than attempted and reported.
  await expect(row(tab, "chapters/figures")).toBeVisible();
  await expect(
    row(tab, "chapters/figures/chapters"),
  ).toHaveCount(0);
});

test("a tab follows the folder it was in", async ({ app, project, tab }) => {
  // The bug this guards: a folder move remapped only the folder's own path,
  // so an open file inside it kept pointing at a place that no longer
  // existed -- and the next autosave wrote it back there.
  await put(tab, app.base, app.token, project.id, "chapters/02_theory.tex");
  await tab.getByTestId("new-folder").click();
  await tab.keyboard.type("parts");
  await tab.keyboard.press("Enter");
  await expect(row(tab, "parts")).toBeVisible({ timeout: 15_000 });

  await row(tab, "chapters/02_theory.tex").click();
  await expect(
    tab.locator('[data-tab][data-path="chapters/02_theory.tex"]'),
  ).toBeVisible();

  await dragRow(tab, "chapters", "parts");

  await expect(
    tab.locator('[data-tab][data-path="parts/chapters/02_theory.tex"]'),
  ).toBeVisible({ timeout: 15_000 });
});
