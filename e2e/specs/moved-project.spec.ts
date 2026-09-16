import { renameSync, rmSync } from "node:fs";
import { join } from "node:path";
import { test, expect } from "../fixtures";

/** A project whose folder moved or went away.
 *
 *  Both of these were dead ends: the entry could not be removed, because a
 *  missing project had no id to address it by, and there was no way to say
 *  where the folder had gone short of removing it and adding the new path.
 */

test("a folder that is gone is reported, and the entry can be removed", async ({
  app,
  project,
  page,
}) => {
  rmSync(project.root, { recursive: true, force: true });
  await page.goto(`${app.base}/?token=${app.token}`);
  await expect(page.getByText("This folder is no longer there.")).toBeVisible({
    timeout: 20_000,
  });

  await page.getByRole("button", { name: "Remove" }).first().click();
  // The confirmation used to collapse and do nothing at all.
  await page.getByRole("button", { name: "Remove" }).last().click();
  await expect(page.getByText("This folder is no longer there.")).toHaveCount(0, {
    timeout: 10_000,
  });
});

test("a folder that moved can be pointed at its new home", async ({
  app,
  project,
  page,
}) => {
  const moved = join(project.root, "..", `${project.root.split("/").pop()}-moved`);
  renameSync(project.root, moved);

  await page.goto(`${app.base}/?token=${app.token}`);
  await expect(page.getByText("This folder is no longer there.")).toBeVisible({
    timeout: 20_000,
  });

  await page.getByTestId("find-project").click();
  await page.getByPlaceholder("Where is it now?").fill(moved);
  await page.getByTestId("confirm-relocate").click();

  // The entry recovers in place rather than being thrown away and re-added.
  await expect(page.getByText("This folder is no longer there.")).toHaveCount(0, {
    timeout: 15_000,
  });
  await expect(page.getByText(moved, { exact: false })).toBeVisible();
  // And it opens, which is the whole point of recovering it.
  await page.getByText(moved, { exact: false }).click();
  await expect(page.locator(".cm-editor")).toBeVisible({ timeout: 30_000 });
});

test("pointing it somewhere that is not there says so, on the row", async ({
  app,
  project,
  page,
}) => {
  rmSync(project.root, { recursive: true, force: true });
  await page.goto(`${app.base}/?token=${app.token}`);
  await expect(page.getByText("This folder is no longer there.")).toBeVisible({
    timeout: 20_000,
  });

  await page.getByTestId("find-project").click();
  await page.getByPlaceholder("Where is it now?").fill("/nowhere/at/all");
  await page.getByTestId("confirm-relocate").click();
  // Beside the input it belongs to, not at the bottom of the screen under
  // the create form, where it would read as a create error.
  await expect(page.getByText(/no such directory/i)).toBeVisible({
    timeout: 10_000,
  });
  await expect(page.getByText("This folder is no longer there.")).toBeVisible();
});

test("a folder removed while the project is open sends the editor back to the list", async ({
  tab,
  project,
}) => {
  // The watcher has to be looking at this root before it goes; a project
  // it picks up within a second of being opened.
  await tab.waitForTimeout(1_500);
  rmSync(project.root, { recursive: true, force: true });

  // Not a message inside an editor over nothing: the editor is left, and
  // the list says why, beside the row that says the folder is missing.
  await expect(tab.getByTestId("folder-lost")).toBeVisible({ timeout: 20_000 });
  await expect(tab.getByTestId("folder-lost")).toContainText("gone from this disk");
  await expect(tab.getByText("This folder is no longer there.")).toBeVisible();
  await expect(tab.locator(".cm-editor")).toHaveCount(0);

  await tab.getByRole("button", { name: "Dismiss" }).click();
  await expect(tab.getByTestId("folder-lost")).toHaveCount(0);
});

test("a shared project whose folder is gone offers a way back in", async ({
  app,
  project,
  page,
}) => {
  await page.goto(`${app.base}/?token=${app.token}`);
  const shared = await page.request.post(
    `${app.base}/api/projects/${project.id}/collab/share`,
    { data: { name: "Wilhelmina" } },
  );
  expect(shared.ok()).toBeTruthy();
  rmSync(project.root, { recursive: true, force: true });

  await page.reload();
  await expect(page.getByText("This folder is no longer there.")).toBeVisible({
    timeout: 20_000,
  });
  // Both exits, side by side: the folder may have moved, or it may be gone
  // and the collaborators still have theirs.
  await expect(page.getByTestId("find-project")).toBeVisible();
  await page.getByTestId("rejoin-project").click();
  // Defaults to where it was, which is usually where the writer wants it.
  const where = page.getByPlaceholder("An empty folder for it to arrive in");
  await expect(where).toHaveValue(project.root);
  await expect(page.getByText("Nothing is written until you accept")).toBeVisible();
  await page.getByRole("button", { name: "Cancel" }).click();
  await expect(where).toHaveCount(0);
});

test("a private project whose folder is gone is not offered a rejoin", async ({
  app,
  project,
  page,
}) => {
  rmSync(project.root, { recursive: true, force: true });
  await page.goto(`${app.base}/?token=${app.token}`);
  await expect(page.getByText("This folder is no longer there.")).toBeVisible({
    timeout: 20_000,
  });
  await expect(page.getByTestId("find-project")).toBeVisible();
  await expect(page.getByTestId("rejoin-project")).toHaveCount(0);
});

test("the offer card says what accepting does to a folder that already has files", async ({
  app,
  project,
  page,
}) => {
  // A second NextTex is not available inside one spec, so the answer the
  // server gives for a rejoin into a copy is played back here; what is
  // under test is the card that reads it.
  await page.goto(`${app.base}/?token=${app.token}`);
  const shared = await page.request.post(
    `${app.base}/api/projects/${project.id}/collab/share`,
    { data: { name: "Wilhelmina" } },
  );
  expect(shared.ok()).toBeTruthy();
  rmSync(project.root, { recursive: true, force: true });
  await page.route("**/api/collab/rejoin", (route) =>
    route.fulfill({
      json: {
        ok: true,
        token: "played-back",
        path: project.root,
        existing: true,
        files: [
          { path: "main.tex", kind: "text", size: 900, refused: false, outcome: "same" },
          { path: "notes.tex", kind: "text", size: 40, refused: false, outcome: "differs" },
          { path: "extra.tex", kind: "text", size: 12, refused: false, outcome: "new here" },
          { path: "chapters/two.tex", kind: "text", size: 300, refused: false, outcome: "new from peers" },
          { path: "old.tex", kind: "text", size: 20, refused: false, outcome: "deleted elsewhere" },
        ],
      },
    }),
  );

  await page.reload();
  await page.getByTestId("rejoin-project").click({ timeout: 20_000 });
  await page.getByTestId("confirm-rejoin").click();
  const card = page.getByTestId("join-offer");
  await expect(card).toBeVisible({ timeout: 10_000 });
  await expect(card).toContainText("already has files");
  await expect(card.locator('[data-outcome="same"]')).toContainText("same as yours");
  await expect(card.locator('[data-outcome="differs"]')).toContainText("kept in its history");
  await expect(card.locator('[data-outcome="new here"]')).toContainText("goes to everybody");
  await expect(card.locator('[data-outcome="new from peers"]')).toContainText("new from the others");
  await expect(card.locator('[data-outcome="deleted elsewhere"]')).toContainText("goes to the trash");
});
