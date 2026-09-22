import { test, expect, openProject } from "../fixtures";
import type { Page } from "@playwright/test";

/** What the interface remembers about a project between visits.
 *
 *  The drawer's width, which drawer is showing, which panes are folded
 *  and which files are open are kept per project in the browser, and
 *  come back on a reload and on a return from the projects screen.  The
 *  writer found a project opening with a drawer wider than the narrowest
 *  they had dragged it to; nothing exercised the width across a visit,
 *  and a double click on the divider, which puts the width back to its
 *  default, set it without storing it.
 */

async function drawerWidth(page: Page): Promise<number> {
  return Math.round((await page.getByTestId("drawer").boundingBox())!.width);
}

async function drag(page: Page, dx: number): Promise<void> {
  const handle = page.locator(".nx-handle").first();
  const h = (await handle.boundingBox())!;
  await page.mouse.move(h.x, h.y + 300);
  await page.mouse.down();
  await page.mouse.move(h.x + dx, h.y + 300, { steps: 8 });
  await page.waitForTimeout(120);
  await page.mouse.up();
  await page.waitForTimeout(120);
}

async function reload(page: Page): Promise<void> {
  await page.reload();
  await page.locator(".cm-editor").waitFor({ timeout: 20_000 });
  await page.waitForTimeout(300);
}

test("the drawer's width is remembered across a reload and a return to the project", async ({
  project, tab,
}) => {
  expect(await drawerWidth(tab)).toBe(240);
  await drag(tab, -400);
  expect(await drawerWidth(tab)).toBe(180);

  await reload(tab);
  expect(await drawerWidth(tab)).toBe(180);

  // Out to the projects screen and in again.
  await tab.getByTestId("switch-project").click();
  await tab.getByText("Projects", { exact: false }).first().waitFor();
  await openProject(tab, project.root);
  await tab.waitForTimeout(300);
  expect(await drawerWidth(tab)).toBe(180);
});

test("a double click on the divider resets the width, and the reset is remembered", async ({
  tab,
}) => {
  await drag(tab, -400);
  expect(await drawerWidth(tab)).toBe(180);
  await tab.locator(".nx-handle").first().dblclick();
  // The pane glides to its new width over 180 ms.
  await expect.poll(() => drawerWidth(tab)).toBe(240);

  await reload(tab);
  expect(await drawerWidth(tab)).toBe(240);
});

test("the drawer that was showing is the one that comes back", async ({ tab }) => {
  await tab.getByTestId("activity-bar").getByRole("button", { name: /history/i }).click();
  await expect(tab.getByTestId("drawer")).toHaveAttribute("data-drawer", "history");

  await reload(tab);
  await expect(tab.getByTestId("drawer")).toHaveAttribute("data-drawer", "history");
});
