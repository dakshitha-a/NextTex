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
