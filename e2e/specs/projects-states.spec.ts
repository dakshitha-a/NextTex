import { test, expect } from "../fixtures";
import { seedProject } from "../server";

/** Archived and trashed: two reversible states in front of "delete".
 *
 *  NextTex registers projects rather than importing them, so the only way
 *  a project left the list was to forget its entry.  Now a row can be
 *  archived (kept, out of the way) or put in the trash (on the way out),
 *  each state has its view, and opening a project from either makes it
 *  active again.  Nothing here touches a folder.
 */

async function land(app: { base: string; token: string }, page: import("@playwright/test").Page) {
  await page.goto(`${app.base}/?token=${app.token}`);
  await page.getByRole("heading", { name: "Projects" }).waitFor();
}

test("Archive and Trash move a row to its view, Restore brings it back, and the quiet line counts", async ({
  app,
  page,
}) => {
  await seedProject(app, "thesis");
  await seedProject(app, "aims");
  await seedProject(app, "scratch");
  await land(app, page);
  await expect(page.getByTestId("project-row")).toHaveCount(3);
  // Nothing under the list while nothing is archived or in the trash.
  await expect(page.getByTestId("projects-under")).toHaveCount(0);

  const rowNamed = (name: string) =>
    page.getByTestId("project-row").filter({ hasText: name });
  await rowNamed("aims").hover();
  // Archive and the trash are in the row's More menu.
  await rowNamed("aims").getByTestId("row-more").click();
  await page.getByTestId("row-archive").click();
  await rowNamed("scratch").hover();
  await rowNamed("scratch").getByTestId("row-more").click();
  await page.getByTestId("row-trash").click();
  await expect(page.getByTestId("project-row")).toHaveCount(1);
  await expect(page.getByTestId("project-count")).toHaveText("1 project");
  const under = page.getByTestId("projects-under");
  await expect(under).toHaveText("1 archived · 1 in the trash");

  // The Archived view: the heading, the way back, the same rows with
  // the state after the path, and Open, Restore and Trash on hover.
  await page.getByTestId("view-archived").click();
  await expect(page.getByRole("heading", { name: "Archived" })).toBeVisible();
  await expect(page.getByTestId("new-project")).toHaveCount(0);
  await expect(page.getByTestId("ways-open")).toHaveCount(0);
  await expect(page.getByTestId("project-count")).toHaveText("1 archived");
  const archived = page.getByTestId("project-row").first();
  await expect(archived).toContainText("aims");
  // At rest the tail says the state and the day; pointed at, the tail is
  // the actions and the stamp reappears after the path.
  await expect(archived.getByTestId("row-opened")).toHaveText("archived today");
  await expect(archived.getByTestId("row-state")).toBeHidden();
  await archived.hover();
  await expect(archived.getByTestId("row-state")).toHaveText(/archived today/);
  await expect(archived.getByTestId("row-actions").getByRole("button")).toHaveText([
    "Open", "Restore", "Trash",
  ]);
  // The find field works in the view.
  await page.getByTestId("project-filter").fill("zzz");
  await expect(page.getByTestId("no-match")).toBeVisible();
  await page.getByTestId("project-filter").fill("");

  // The Trash view: Restore and Delete, and Empty the trash at the foot.
  await page.getByTestId("view-back").click();
  await page.getByTestId("view-trash").click();
  await expect(page.getByRole("heading", { name: "Trash" })).toBeVisible();
  await expect(page.getByTestId("project-count")).toHaveText("1 in the trash");
  const trashed = page.getByTestId("project-row").first();
  await expect(trashed.getByTestId("row-opened")).toHaveText("in the trash since today");
  await trashed.hover();
  await expect(trashed.getByTestId("row-actions").getByRole("button")).toHaveText([
    "Restore", "Delete",
  ]);
  await expect(page.getByTestId("empty-trash")).toBeVisible();
  // A trashed row is not opened by a press on it: its way back is Restore.
  await expect(trashed).not.toHaveAttribute("role", "button");
  await trashed.getByTestId("row-restore").click();
  await expect(page.getByTestId("view-empty")).toContainText("The trash is empty.");
  await page.getByTestId("view-back").click();
  await expect(page.getByTestId("project-row")).toHaveCount(2);
  await expect(under).toHaveText("1 archived");
});

test("Delete in the trash forgets the entry after asking, and Empty the trash forgets them all", async ({
  app,
  page,
}) => {
  const kept = await seedProject(app, "kept");
  await seedProject(app, "one");
  await seedProject(app, "two");
  await land(app, page);
  for (const name of ["one", "two"]) {
    const row = page.getByTestId("project-row").filter({ hasText: name });
    await row.hover();
    await row.getByTestId("row-more").click();
    await page.getByTestId("row-trash").click();
  }
  await page.getByTestId("view-trash").click();
  await expect(page.getByTestId("project-row")).toHaveCount(2);

  // Delete asks first, in the row, with the words Remove had.
  const one = page.getByTestId("project-row").filter({ hasText: "one" });
  await one.hover();
  await one.getByTestId("row-delete").click();
  await expect(one).toContainText("Delete from NextTex? The files stay where they are.");
  await one.getByRole("button", { name: "Keep" }).click();
  await expect(page.getByTestId("project-row")).toHaveCount(2);
  await one.hover();
  await one.getByTestId("row-delete").click();
  await one.getByTestId("confirm-delete").click();
  await expect(page.getByTestId("project-row")).toHaveCount(1);

  // Empty the trash asks once for all of them.
  await page.getByTestId("empty-trash").click();
  await expect(page.getByTestId("projects-under")).toContainText("Delete this project from NextTex?");
  await page.getByTestId("confirm-empty-trash").click();
  await expect(page.getByTestId("view-empty")).toContainText("The trash is empty.");
  await page.getByTestId("view-back").click();
  await expect(page.getByTestId("project-row")).toHaveCount(1);
  await expect(page.getByTestId("project-row")).toContainText("kept");
  await expect(page.getByTestId("projects-under")).toHaveCount(0);

  // The files were never touched.
  const listed = await (await page.request.get(`${app.base}/api/projects`)).json();
  expect(listed.projects.map((p: { id: string }) => p.id)).toEqual([kept.id]);
  const { existsSync } = await import("node:fs");
  expect(existsSync(`${app.projects}/one/main.tex`)).toBe(true);
});

test("opening an archived project makes it active again", async ({ app, page }) => {
  await seedProject(app, "thesis");
  await land(app, page);
  const row = page.getByTestId("project-row").first();
  await row.hover();
  await row.getByTestId("row-more").click();
  await page.getByTestId("row-archive").click();
  await page.getByTestId("view-archived").click();
  await page.getByTestId("project-row").first().hover();
  await page.getByTestId("row-open").click();
  await expect(page.locator(".cm-editor")).toBeVisible({ timeout: 30_000 });
  // Back to the list: the row is a project again, and nothing is archived.
  await page.getByTestId("switch-project").click();
  await page.getByRole("heading", { name: "Projects" }).waitFor();
  await expect(page.getByTestId("project-row")).toHaveCount(1);
  await expect(page.getByTestId("projects-under")).toHaveCount(0);
  const listed = await (await page.request.get(`${app.base}/api/projects`)).json();
  expect(listed.projects[0].state).toBe("active");
});
