import { test, expect } from "../fixtures";
import { seedProject } from "../server";

/** The projects screen when there is a real number of projects on it.
 *
 *  Every other spec seeds one project, so nothing had ever looked at the
 *  screen with twelve. With that many the sheet is taller than a 1000px
 *  window, and the column that holds it centred the overflow: the top of
 *  the sheet, with the logo, the agent button, help, the cog and Back on
 *  it, sat above the top of the scroll area where no scroll position
 *  reaches. The masthead has to be on screen or reachable however long
 *  the list is, and a short list still has its sheet centred.
 */

const NAMES = [
  "thesis", "conical-intersections-paper", "grant-proposal-2027",
  "lecture-notes-quantum-dynamics", "notes", "review-response",
  "chapter-3-draft", "poster-acs", "cv", "collab-with-maria",
  "old-thesis-backup", "figures-for-the-talk",
];

test("the masthead is reachable with twelve projects", async ({ app, page }) => {
  for (const name of NAMES) await seedProject(app, name);
  await page.setViewportSize({ width: 1680, height: 1000 });
  await page.goto(`${app.base}/?token=${app.token}`);
  await page.getByText("Projects", { exact: false }).first().waitFor();
  await expect(page.getByText(NAMES[NAMES.length - 1], { exact: true })).toBeVisible();

  const top = await page.locator("h1").evaluate((h1) => h1.getBoundingClientRect().top);
  expect(top).toBeGreaterThanOrEqual(0);
  const cog = page.getByTestId("appearance");
  await expect(cog).toBeVisible();
  await cog.click();
  await expect(cog).toHaveAttribute("aria-expanded", "true");
});

test("a short list keeps its sheet centred", async ({ app, project, page }) => {
  await page.setViewportSize({ width: 1680, height: 1000 });
  await page.goto(`${app.base}/?token=${app.token}`);
  await page.getByText("Projects", { exact: false }).first().waitFor();
  await expect(page.getByText(project.root.split("/").pop()!, { exact: true })).toBeVisible();
  const box = await page
    .locator(".nx-furniture > div")
    .first()
    .evaluate((sheet) => {
      const rect = sheet.getBoundingClientRect();
      return { top: rect.top, bottom: window.innerHeight - rect.bottom };
    });
  // Centred: as much room above as below, give or take the padding.
  expect(Math.abs(box.top - box.bottom)).toBeLessThan(4);
  expect(box.top).toBeGreaterThan(100);
});


test("a row says when it was opened, and its actions are there without a hover", async ({
  app, project, page,
}) => {
  await page.goto(`${app.base}/?token=${app.token}`);
  await page.getByText("Projects", { exact: false }).first().waitFor();
  const row = page.getByTestId("project-row").first();
  // Registered a moment ago counts as opened a moment ago; the registry
  // stamps an entry when it is added.
  await expect(row.getByTestId("row-opened")).toHaveText("just now");
  // The path is folded to `~` when it is under home; the sandbox is not,
  // so the row shows it whole, and the title carries the whole path.
  await expect(row.locator("[title]").first()).toHaveAttribute("title", project.root);

  // At rest the actions are not drawn, and they are still real buttons:
  // a keyboard reaches them and a click lands without a hover first.
  const actions = row.getByTestId("row-actions");
  await expect(actions).toHaveCSS("opacity", "0");
  await page.mouse.move(0, 0);
  await actions.getByRole("button", { name: "Remove" }).click();
  await expect(row.getByText("Remove from NextTex?")).toBeVisible();
  await row.getByRole("button", { name: "Keep" }).click();

  // Pointed at, the actions are drawn and the time gives way to them.
  await row.hover();
  await expect(actions).toHaveCSS("opacity", "1");
  await expect(row.getByTestId("row-opened")).toHaveCSS("opacity", "0");
});
