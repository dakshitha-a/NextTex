import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { test, expect, openFolders, openProject } from "../fixtures";

/** A menu never opens below the screen.
 *
 *  The tree's row menu was placed with a guess at its own height, and the
 *  guess was 220px for a menu that is 306px on a `.tex` row and taller
 *  still with its history-deletion question open.  From a row near the
 *  foot of a short window the last items, *Move to trash* among them,
 *  were below the screen and could not be reached.  The placement is
 *  measured now, in `frontend/src/place-menu.ts`, whose vitest has the
 *  arithmetic; what only a browser can say is that the real menu, from
 *  the real last row, in a real short window, ends inside it.
 */

test.use({ viewport: { width: 1600, height: 600 } });

test("the last row's menu ends inside a short window, question and all", async ({
  app, project, page,
}) => {
  mkdirSync(join(project.root, "chapters"), { recursive: true });
  for (let i = 0; i < 40; i += 1) {
    writeFileSync(join(project.root, "chapters", `ch${String(i).padStart(2, "0")}.tex`), `Chapter ${i}\n`);
  }
  await page.goto(`${app.base}/?token=${app.token}`);
  await page.getByText("Projects", { exact: false }).first().waitFor();
  await openProject(page, project.root);
  await expect(page.locator(".cm-editor")).toBeVisible({ timeout: 30_000 });

  await openFolders(page, "chapters/ch39.tex");
  const last = page.locator('[role="tree"] [data-path="chapters/ch39.tex"]');
  await last.scrollIntoViewIfNeeded();
  await last.hover();
  await last.getByLabel("Actions for ch39.tex").click();
  const menu = page.getByTestId("file-menu");
  await expect(menu).toBeVisible();

  const inside = async () => {
    const box = (await menu.boundingBox())!;
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.y + box.height).toBeLessThanOrEqual(600);
  };
  await inside();
  // The item that used to be off the bottom.
  await expect(menu.getByRole("button", { name: "Move to trash" })).toBeInViewport();
  // A menu that flipped above its button is still one the button opened:
  // the button is not covered by it.
  const button = (await last.getByLabel("Actions for ch39.tex").boundingBox())!;
  const box = (await menu.boundingBox())!;
  expect(box.y + box.height <= button.y || box.y >= button.y + button.height).toBe(true);

  // The question inside the menu makes it taller, and it is measured
  // again when it opens.
  await menu.getByRole("button", { name: "Delete version history…" }).click();
  await expect(page.getByTestId("purge-confirm")).toBeVisible();
  await inside();
  await expect(page.getByTestId("purge-confirm-no")).toBeInViewport();
});

test("a window shorter than the menu gets a menu that scrolls", async ({
  app, project, page,
}) => {
  await page.setViewportSize({ width: 1600, height: 260 });
  await page.goto(`${app.base}/?token=${app.token}`);
  await page.getByText("Projects", { exact: false }).first().waitFor();
  await openProject(page, project.root);
  await expect(page.locator(".cm-editor")).toBeVisible({ timeout: 30_000 });

  const row = page.locator('[role="tree"] [data-path="main.tex"]');
  await row.hover();
  await row.getByLabel("Actions for main.tex").click();
  const menu = page.getByTestId("file-menu");
  await expect(menu).toBeVisible();
  const box = (await menu.boundingBox())!;
  expect(box.y).toBeGreaterThanOrEqual(0);
  expect(box.y + box.height).toBeLessThanOrEqual(260);
  // Every item is reachable by scrolling the menu itself.
  const trash = menu.getByRole("button", { name: "Move to trash" });
  await trash.scrollIntoViewIfNeeded();
  await expect(trash).toBeInViewport();
});
