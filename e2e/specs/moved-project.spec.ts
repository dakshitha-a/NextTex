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
