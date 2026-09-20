import { test, expect } from "../fixtures";
import { seedProject } from "../server";

/** Sharing from the projects screen: a row's Share opens the same sheet
 *  the workspace uses, over the list, without opening the project.
 *
 *  A second NextTex is not available inside one spec, so what is under
 *  test is the sheet from the row, the invite it makes, and the mark the
 *  row wears afterwards.
 */

async function land(app: { base: string; token: string }, page: import("@playwright/test").Page) {
  await page.goto(`${app.base}/?token=${app.token}`);
  await page.getByText("Projects", { exact: true }).waitFor();
}

test("Share on a row opens the sheet for that project, and the row says shared afterwards", async ({
  app,
  page,
}) => {
  await seedProject(app, "thesis");
  await land(app, page);
  const row = page.getByTestId("project-row").first();
  await expect(row).toContainText("thesis");
  await expect(row.locator(".nx-project-mark")).toHaveCount(0);

  // Revealed under the pointer, like the rest of the row's actions.
  await row.hover();
  await row.getByTestId("row-share").click();
  const sheet = page.getByRole("dialog", { name: "Share thesis" });
  await expect(sheet).toBeVisible();
  // Private: one filled button, no invite yet, nothing to stop, only you.
  await expect(sheet).toHaveAttribute("data-state", "private", { timeout: 10_000 });
  await expect(sheet.getByTestId("invite-text")).toHaveCount(0);
  await expect(sheet.getByTestId("leave-share")).toHaveCount(0);
  await expect(sheet.getByText("You", { exact: true })).toBeVisible();
  await expect(sheet.getByText("this computer")).toBeVisible();

  // One press shares the project and makes the invite.
  await sheet.getByTestId("make-invite").click();
  const invite = sheet.getByTestId("invite-text");
  await expect(invite).toBeVisible({ timeout: 10_000 });
  await expect(invite).toHaveValue(/^nexttex-share-v1-/);
  await expect(sheet.getByText("An invite for one person, usable once")).toBeVisible();
  await expect(sheet).toHaveAttribute("data-state", "shared");
  await expect(sheet.getByTestId("leave-share")).toBeVisible();
  await expect(sheet.getByTestId("make-invite")).toBeVisible();

  // The project was never opened: no editor under the sheet, and the
  // list is still the screen when the sheet closes.
  await expect(page.locator(".cm-editor")).toHaveCount(0);
  await sheet.getByTestId("share-close").click();
  await expect(sheet).toHaveCount(0);
  await expect(row.locator(".nx-project-mark")).toHaveText(/shared/);
  await expect(page.getByText("Projects", { exact: true })).toBeVisible();
});

test("Stop sharing from the list asks first and takes the mark off the row", async ({
  app,
  page,
}) => {
  const seeded = await seedProject(app, "thesis");
  // The page first, so the request carries the token the list landed with.
  await land(app, page);
  const shared = await page.request.post(
    `${app.base}/api/projects/${seeded.id}/collab/share`,
    { data: { name: "Wilhelmina" } },
  );
  expect(shared.ok()).toBeTruthy();
  await page.reload();
  await page.getByText("Projects", { exact: true }).waitFor();
  const row = page.getByTestId("project-row").first();
  await expect(row.locator(".nx-project-mark")).toHaveText(/shared/);

  await row.hover();
  await row.getByTestId("row-share").click();
  const sheet = page.getByTestId("share-panel");
  await expect(sheet).toHaveAttribute("data-state", "shared", { timeout: 10_000 });
  await sheet.getByTestId("leave-share").click();
  await expect(sheet.getByTestId("leave-words")).toContainText("Your copy stays on this computer");
  await sheet.getByTestId("confirm-leave").click();
  await expect(sheet).toHaveAttribute("data-state", "private", { timeout: 10_000 });
  await sheet.getByTestId("share-close").click();
  await expect(row.locator(".nx-project-mark")).toHaveCount(0);
});

test("a missing folder cannot be shared from its row", async ({ app, page }) => {
  const seeded = await seedProject(app, "gone");
  const { rmSync } = await import("node:fs");
  rmSync(seeded.root, { recursive: true, force: true });
  await land(app, page);
  const row = page.getByTestId("project-row").first();
  await expect(row.getByText("This folder is no longer there.")).toBeVisible({ timeout: 20_000 });
  await expect(row.getByTestId("row-share")).toBeDisabled();
});
