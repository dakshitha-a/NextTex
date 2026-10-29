import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test, expect } from "../fixtures";

// A NextTex of its own: this spec renames rows of the projects screen and
// reads the list back, and a shared server holds every other test's rows.
test.use({ ownServer: true });

/** A project can be renamed: from its row's More menu on the projects
 *  screen, and from a right-click on its name inside it (the direction
 *  page's "A project's name, its moved folder, and the three lists").
 *  The name is the one in nexttex.toml; the folder keeps its own. */

test("Rename in a row's menu edits the name in place, and Escape or an empty name keeps the old one", async ({
  app,
  project,
  page,
}) => {
  const folder = project.root.split("/").pop()!;
  await page.goto(`${app.base}/?token=${app.token}`);
  await page.getByRole("heading", { name: "Projects" }).waitFor();
  const row = page.getByTestId("project-row").first();
  await row.hover();
  await row.getByTestId("row-more").click();
  await page.getByTestId("row-rename").click();

  // The field holds the name, selected, so typing replaces it.
  const field = row.getByTestId("project-rename");
  await expect(field).toBeFocused();
  await expect(field).toHaveValue(folder);
  await page.keyboard.type("Grant renewal");
  await page.keyboard.press("Escape");
  await expect(row.getByTestId("project-name")).toHaveText(folder);

  // An empty name is not kept.
  await row.hover();
  await row.getByTestId("row-more").click();
  await page.getByTestId("row-rename").click();
  await field.fill("   ");
  await field.press("Enter");
  await expect(row.getByTestId("project-name")).toHaveText(folder);

  // Enter keeps it, and the press does not open the project.
  await row.hover();
  await row.getByTestId("row-more").click();
  await page.getByTestId("row-rename").click();
  await field.fill("Grant renewal, aims page");
  await field.press("Enter");
  await expect(row.getByTestId("project-name")).toHaveText("Grant renewal, aims page");
  await expect(page.locator(".cm-editor")).toHaveCount(0);
  // Written into the project, and the folder is where it was.
  expect(readFileSync(join(project.root, "nexttex.toml"), "utf-8")).toContain('name = "Grant renewal, aims page"');
  await page.reload();
  await expect(page.getByTestId("project-name").first()).toHaveText("Grant renewal, aims page");
});

test("a right-click on the open project's name offers Rename project, and the name and title follow", async ({
  tab,
}) => {
  const bar = tab.getByTestId("title-bar");
  await bar.click({ button: "right" });
  const menu = tab.getByTestId("title-menu");
  await expect(menu.getByRole("menuitem")).toHaveText(["Rename project", "Switch project"]);
  await tab.getByTestId("title-menu-rename").click();
  const field = tab.getByTestId("title-rename");
  await expect(field).toBeFocused();
  await field.fill("Dynamics at conical intersections");
  await field.press("Enter");
  await expect(tab.getByTestId("project-name")).toHaveText("Dynamics at conical intersections");
  await expect(tab).toHaveTitle(/Dynamics at conical intersections/);

  // Escape leaves the name as it was.
  await bar.click({ button: "right" });
  await tab.getByTestId("title-menu-rename").click();
  await field.fill("Something else");
  await field.press("Escape");
  await expect(tab.getByTestId("project-name")).toHaveText("Dynamics at conical intersections");

  // A plain click still goes back to the list, which shows the new name.
  await tab.getByTestId("switch-project").click();
  await tab.getByRole("heading", { name: "Projects" }).waitFor();
  await expect(tab.getByTestId("project-row").filter({ hasText: "Dynamics at conical intersections" })).toHaveCount(1);
});
