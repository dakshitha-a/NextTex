import { test, expect } from "../fixtures";
import type { Page } from "@playwright/test";
import { landed } from "../typing";

/** Getting back what you had.
 *
 *  These are the app's promise that nothing is ever really lost, and both
 *  of them are almost entirely browser code.
 */

/** Type, and wait until it is on disk.
 *
 *  There is no save request to wait for any more: the text goes into the
 *  shared document over a socket and the server writes the file from there.
 *  So this waits for the file to say the right thing, which is what the old
 *  version was using the response as a proxy for. */
async function typeAndSave(page: Page, text: string, app: any, project: any) {
  await page.locator(".cm-content").click();
  await page.keyboard.press("Control+a");
  await page.keyboard.type(text);
  await landed(app, project, text);
}

async function openHistory(page: Page) {
  await page.getByLabel("Actions for main.tex").click();
  // Exact: "Delete version history…" is in the same menu now.
  await page
    .getByRole("tree")
    .getByRole("button", { name: "History", exact: true })
    .click();
  await expect(page.getByTestId("version").first()).toBeVisible({
    timeout: 10_000,
  });
}

test("every save is a version, and an old one can be read", async ({ tab, app, project }) => {
  await typeAndSave(tab, "the first draft", app, project);
  // Past the coalescing window would take ninety seconds; two saves from
  // one window inside it are deliberately one version, so this asserts what
  // the app promises rather than what would be convenient.
  await openHistory(tab);
  const rows = tab.getByTestId("version");
  await expect(rows.first()).toBeVisible();

  await rows.last().click();
  await expect(tab.getByText(/viewing/i).first()).toBeVisible();
});

test("a version being read cannot be typed into", async ({ app, project, tab }) => {
  await typeAndSave(tab, "the draft as it was", app, project);
  await openHistory(tab);
  await tab.getByTestId("version").last().click();
  await expect(tab.getByText(/viewing/i).first()).toBeVisible();

  // Read-only three separate ways, and this is the one the browser
  // enforces: the content is not editable at all.
  await expect(tab.locator(".cm-content")).toHaveAttribute(
    "contenteditable", "false",
  );
  await tab.locator(".cm-content").click({ position: { x: 30, y: 20 } });
  await tab.keyboard.type("THIS MUST NOT BE SAVED");
  await tab.waitForTimeout(1_200);        // past the autosave, deliberately
  await expect(tab.locator(".cm-content")).not.toContainText(
    "THIS MUST NOT BE SAVED",
  );

  const file = await fetch(
    `${app.base}/api/projects/${project.id}/file?path=main.tex`,
    { headers: { "x-nexttex-token": app.token } },
  ).then((r) => r.json());
  expect(file.text).not.toContain("THIS MUST NOT BE SAVED");
});

test("coming back from a version restores the live buffer, editable", async ({
  tab,
  app,
  project,
}) => {
  await typeAndSave(tab, "the live text", app, project);
  await openHistory(tab);
  await tab.getByTestId("version").last().click();
  await expect(tab.getByText(/viewing/i).first()).toBeVisible();

  await tab.getByRole("button", { name: /back to now/i }).click();
  await expect(tab.getByText(/viewing/i)).toHaveCount(0);
  await expect(tab.locator(".cm-content")).toContainText("the live text");
});

test("a deleted file goes to the trash and comes back byte for byte", async ({
  app, project, tab,
}) => {
  const before = await fetch(
    `${app.base}/api/projects/${project.id}/file?path=references.bib`,
    { headers: { "x-nexttex-token": app.token } },
  ).then((r) => r.json());

  await tab.getByLabel("Actions for references.bib").click();
  await tab.getByRole("button", { name: "Move to trash" }).click();
  await expect(tab.getByTestId("trash-entry")).toHaveCount(0);

  await tab.getByRole("button", { name: /deleted/ }).click();
  const entry = tab.getByTestId("trash-entry").filter({ hasText: "references" });
  await expect(entry).toBeVisible({ timeout: 10_000 });

  await entry.hover();
  await entry.getByRole("button", { name: "Restore" }).click();

  await expect
    .poll(
      async () => {
        const back = await fetch(
          `${app.base}/api/projects/${project.id}/file?path=references.bib`,
          { headers: { "x-nexttex-token": app.token } },
        ).then((r) => r.json());
        return back.text;
      },
      { timeout: 15_000 },
    )
    .toBe(before.text);
});

test("emptying the trash asks before it destroys anything", async ({ tab }) => {
  await tab.getByLabel("Actions for references.bib").click();
  await tab.getByRole("button", { name: "Move to trash" }).click();
  await tab.getByRole("button", { name: /deleted/ }).click();

  const entry = tab.getByTestId("trash-entry").first();
  await expect(entry).toBeVisible({ timeout: 10_000 });
  await entry.hover();
  await entry.getByRole("button", { name: "Delete" }).click();
  // Nothing is destroyed on one click: the trash is the last copy there is.
  await expect(entry.getByText("For good?")).toBeVisible();
  await entry.getByRole("button", { name: "Keep" }).click();
  await expect(entry).toBeVisible();
});

test("naming a version makes it findable later", async ({ tab, app, project }) => {
  // The one thing that turns a wall of timestamps into something a writer
  // can navigate: "the version that went to the committee".
  await typeAndSave(tab, "the version that went to the committee", app, project);
  await openHistory(tab);

  const row = tab.getByTestId("version").first();
  await row.hover();
  await row.getByRole("button", { name: /name it/i }).click();
  await tab.keyboard.type("sent to the committee");
  await tab.keyboard.press("Enter");

  await expect(tab.getByText("sent to the committee")).toBeVisible({
    timeout: 10_000,
  });
  // And it survives being reopened, because it is on disk rather than in
  // the panel's state.
  await tab.reload();
  await openHistory(tab);
  await expect(tab.getByText("sent to the committee")).toBeVisible({
    timeout: 15_000,
  });
});

test("the panel marks what an old version had that the file no longer does",
  async ({ tab, app, project }) => {
    await typeAndSave(tab, "something else entirely", app, project);
    await openHistory(tab);

    // The comparison only means anything against a particular version, so
    // the control lives on the strip that says which one is being read.
    // The oldest is the file as it stood before NextTex ever opened it.
    await tab.getByTestId("version").last().click();
    await expect(tab.getByText(/viewing/i).first()).toBeVisible();
    await expect(tab.locator(".cm-version-changed")).toHaveCount(0);

    await tab.getByRole("button", { name: /show what's gone/i }).click();
    // Marked in place, in the paragraph it happened to, rather than shown
    // in a pane of its own -- which is the difference between reading a
    // change and reading a diff.
    await expect(tab.locator(".cm-version-changed").first()).toBeVisible({
      timeout: 10_000,
    });

    await tab.getByRole("button", { name: /hide what's gone/i }).click();
    await expect(tab.locator(".cm-version-changed")).toHaveCount(0);
  });

test("purging asks once, and then really destroys it", async ({
  app, project, tab,
}) => {
  await tab.getByLabel("Actions for references.bib").click();
  await tab.getByRole("button", { name: "Move to trash" }).click();
  await tab.getByRole("button", { name: /deleted/ }).click();

  const entry = tab.getByTestId("trash-entry").first();
  await expect(entry).toBeVisible({ timeout: 10_000 });
  await entry.hover();
  await entry.getByRole("button", { name: "Delete" }).click();
  await expect(entry.getByText("For good?")).toBeVisible();
  await entry.getByRole("button", { name: "Delete" }).click();

  await expect(tab.getByTestId("trash-entry")).toHaveCount(0, {
    timeout: 10_000,
  });
  // Gone from the server too, not just from the panel.
  const trash = await fetch(
    `${app.base}/api/projects/${project.id}/trash`,
    { headers: { "x-nexttex-token": app.token } },
  ).then((r) => r.json());
  expect(trash.entries ?? []).toHaveLength(0);
});

test("a second version, then back to now, still gives you an editable file", async ({
  app, project, tab,
}) => {
  // R-067. `viewVersion` parks whatever the editor is showing so that
  // "Back to now" can restore it, and clicking a second version while the
  // first was on screen parked the read-only state of the first. The
  // writer was then returned to a pane that looked live, was not editable,
  // and swallowed everything typed into it.
  await typeAndSave(tab, "the first draft", app, project);
  await typeAndSave(tab, "the second draft", app, project);
  await openHistory(tab);

  const versions = tab.getByTestId("version");
  await expect.poll(async () => versions.count(), { timeout: 20_000 })
    .toBeGreaterThan(1);

  await versions.nth(0).click();
  await expect(tab.getByText(/viewing/i).first()).toBeVisible();
  await versions.nth(1).click();
  await expect(tab.getByText(/viewing/i).first()).toBeVisible();

  await tab.getByRole("button", { name: /back to now/i }).click();
  await expect(tab.getByText(/viewing/i)).toHaveCount(0);

  // The history panel is an overlay; close it before reaching the editor.
  await tab.getByLabel("Close the history").click();
  await tab.locator(".cm-content").click();
  await tab.keyboard.press("Control+End");
  await tab.keyboard.type("\nStill editable.\n");

  await landed(app, project, "Still editable.");
});

test("a version can be chosen from the keyboard", async ({ tab, app, project }) => {
  // The row lost `role="button"` for `nested-interactive`, and the
  // keyboard's way in became a real button stretched across it with
  // `pointer-events-none` so the pointer still reaches the row once. That
  // is a route worth asserting rather than assuming: a button that cannot
  // be pressed by a mouse is exactly the shape that gets broken later by
  // somebody who reads the CSS and not the reason.
  await typeAndSave(tab, "the first draft", app, project);
  await openHistory(tab);
  const rows = tab.getByTestId("version");
  await expect(rows.first()).toBeVisible();

  const way = rows.last().getByRole("button", { name: /^Version from/ });
  await way.focus();
  await expect(way).toBeFocused();
  await tab.keyboard.press("Enter");
  await expect(tab.getByText(/viewing/i).first()).toBeVisible();
});

test("history can be read for the whole project, not just one file", async ({
  tab,
  app,
  project,
}) => {
  // R-093. To answer "what did I change this afternoon" a writer had to
  // open every file in turn, because History is per file. The route that
  // answers it across the project has existed the whole time, taking a
  // limit and returning every file's versions newest first, with no client
  // wrapper and no caller.
  await typeAndSave(tab, "the first chapter", app, project);

  // A second file with a version of its own. The project is seeded with a
  // bibliography, so this needs no file to be made: what the test is about
  // is two files' versions in one list.
  await tab.getByRole("treeitem", { name: /references\.bib/ }).click();
  await expect(tab.getByTitle("references.bib").first()).toBeVisible({
    timeout: 10_000,
  });
  await tab.locator(".cm-content").click();
  await tab.keyboard.press("Control+End");
  await tab.keyboard.type("\n% a note to self\n");
  await landed(app, project, "a note to self", "references.bib");

  await openHistory(tab);
  await tab.getByRole("button", { name: "Whole project" }).click();

  const rows = tab.getByTestId("version");
  await expect(rows.first()).toBeVisible({ timeout: 10_000 });
  // Each row says which file it belongs to, which is the whole difference
  // between this list and the per-file one.
  await expect(
    tab.getByTestId("history-scope-path").filter({ hasText: "references.bib" }).first(),
  ).toBeVisible();
  await expect(tab.getByTestId("history-scope-path").filter({ hasText: "main.tex" }).first())
    .toBeVisible();
});

test("emptying a history says what it freed, and the panel says what it holds", async ({
  tab,
  app,
  project,
}) => {
  // R-097. The route answers with both a count and a number of bytes and
  // the interface dropped the second, which is the one somebody emptying
  // something is after: a count of versions says nothing about whether it
  // was worth doing. `/history/size` had a client wrapper and no caller.
  await typeAndSave(tab, "a first version worth keeping", app, project);
  await typeAndSave(tab, "and a second one, longer than the first", app, project);

  await openHistory(tab);
  await expect(tab.getByTestId("history-size")).toBeVisible({ timeout: 10_000 });
  await expect(tab.getByTestId("history-size")).toHaveText(/\d+ (B|KB|MB)/);

  await tab.getByLabel("Actions for main.tex").click();
  await tab.getByRole("button", { name: /Delete version history/ }).click();
  await tab.getByTestId("purge-confirm-yes").click();

  await expect(tab.getByText(/freeing \d+ (B|KB|MB)/)).toBeVisible({
    timeout: 10_000,
  });
});

test("a version's patch can be read, and two versions can be compared",
  async ({ tab, app, project }) => {
    // R-089. The shading above marks what an old version had and the file
    // no longer does, in place; it never showed what arrived, and two
    // versions could not be compared with each other at all.
    await typeAndSave(tab, "the second draft", app, project);
    await openHistory(tab);

    // The oldest version is the file as it stood before this test typed.
    await tab.getByTestId("version").last().click();
    await expect(tab.getByText(/viewing/i).first()).toBeVisible();
    await tab.getByTestId("toggle-patch").click();
    const patch = tab.getByTestId("history-patch");
    await expect(patch).toBeVisible({ timeout: 10_000 });
    // What arrived, which the shading could never say.
    await expect(patch).toContainText("+the second draft");
    await expect(patch).toContainText("From that version to the file as it stands");

    // Compare, on another row, shows the patch between the two versions
    // rather than against the live file.
    const rows = tab.getByTestId("version");
    if ((await rows.count()) > 1) {
      await rows.first().hover();
      await rows.first().getByTestId("version-compare").click();
      await expect(patch).toContainText(/From the version/, { timeout: 10_000 });
    }

    await tab.getByTestId("toggle-patch").click();
    await expect(patch).toHaveCount(0);
  });
