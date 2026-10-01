import { test, expect } from "../fixtures";

/** Right-clicks in the file tree.
 *
 *  A row's right-click opens the menu its ⋯ button opens, at the pointer;
 *  the drawer's empty space stands for the project's root and offers the
 *  heading row's four buttons.  Where a menu wants to be is a vitest,
 *  `place-menu.test.ts`; what only a browser can say is that the gesture
 *  reaches the right menu, that only one is ever open, and that the items
 *  do what the buttons they repeat do.
 */

const labels = (menu: any) =>
  menu.getByRole("button").evaluateAll((nodes: HTMLElement[]) =>
    nodes.map((node) => node.textContent?.replace(/F2|Del$/, "").trim()),
  );

test("a row's right-click opens the row's own menu at the pointer", async ({ tab }) => {
  const row = tab.getByRole("treeitem", { name: /main\.tex/ }).first();
  await row.getByLabel("Actions for main.tex").click();
  const fromButton = await labels(tab.getByTestId("file-menu"));
  await tab.keyboard.press("Escape");
  await expect(tab.getByTestId("file-menu")).toHaveCount(0);

  const box = (await row.boundingBox())!;
  await tab.mouse.click(box.x + 40, box.y + box.height / 2, { button: "right" });
  const menu = tab.getByTestId("file-menu");
  await expect(menu).toBeVisible();
  expect(await labels(menu)).toEqual(fromButton);
  const at = (await menu.boundingBox())!;
  expect(Math.abs(at.x - (box.x + 40))).toBeLessThan(4);

  // A right-click inside the open menu leaves it where it is.
  await menu.getByRole("button", { name: "Rename" }).click({ button: "right" });
  expect(Math.abs((await menu.boundingBox())!.x - at.x)).toBeLessThan(1);

  // Another row's right-click moves the one menu there; never two.
  const other = tab.getByRole("treeitem", { name: /references\.bib/ }).first();
  // At its left end, which the open menu, hung at the pointer, does not cover.
  const second = (await other.boundingBox())!;
  await tab.mouse.click(second.x + 12, second.y + second.height / 2, { button: "right" });
  await expect(tab.getByTestId("file-menu")).toHaveCount(1);
  await expect(other.getByTestId("file-menu")).toBeVisible();
  await tab.keyboard.press("Escape");
  await expect(tab.getByTestId("file-menu")).toHaveCount(0);
});

test("the keyboard's menu key opens a row's menu under its button", async ({ tab }) => {
  const row = tab.getByRole("treeitem", { name: /main\.tex/ }).first();
  await row.focus();
  await tab.keyboard.press("Shift+F10");
  const menu = tab.getByTestId("file-menu");
  await expect(menu).toBeVisible();
  const button = (await row.getByLabel("Actions for main.tex").boundingBox())!;
  expect((await menu.boundingBox())!.y).toBeGreaterThan(button.y);
});

test("Shift with a right-click is left to the browser", async ({ tab }) => {
  await tab.getByRole("treeitem", { name: /main\.tex/ }).first().click({
    button: "right",
    modifiers: ["Shift"],
  });
  await tab.getByRole("tree").click({ button: "right", position: { x: 40, y: 280 } });
  // The plain right-click after it proves a menu had time to appear.
  await expect(tab.getByTestId("tree-root-menu")).toBeVisible();
  await expect(tab.getByTestId("file-menu")).toHaveCount(0);
});

test("the tree's empty space offers the heading row's buttons at the root", async ({ tab }) => {
  const tree = tab.getByRole("tree");
  await tree.click({ button: "right", position: { x: 40, y: 280 } });
  const menu = tab.getByTestId("tree-root-menu");
  await expect(menu).toBeVisible();
  expect(await labels(menu)).toEqual(["New file", "New folder", "Upload files", "Find a file"]);

  await menu.getByRole("button", { name: "New folder" }).click();
  await tab.keyboard.type("drafts");
  await tab.keyboard.press("Enter");
  await expect(tab.locator('[role="treeitem"][data-path="drafts"]')).toBeVisible({ timeout: 15_000 });

  // A right-click on a row is the row's, never the root's.
  await tab.getByRole("treeitem", { name: /main\.tex/ }).first().click({ button: "right" });
  await expect(tab.getByTestId("tree-root-menu")).toHaveCount(0);
  await expect(tab.getByTestId("file-menu")).toBeVisible();
  await tab.keyboard.press("Escape");

  await tree.click({ button: "right", position: { x: 40, y: 280 } });
  await tab.getByTestId("tree-root-menu").getByRole("button", { name: "Find a file" }).click();
  await expect(tab.getByTestId("file-search")).toBeFocused();
});

test("Copy path puts a file's absolute path on the clipboard, and a folder's", async ({ tab, project, context }) => {
  // Asked for by the writer: the path on the machine running NextTex, for a
  // terminal or an editor beside it.
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  const row = tab.getByRole("treeitem", { name: /main\.tex/ }).first();
  await row.click({ button: "right" });
  const menu = tab.getByTestId("file-menu");
  // With the other name-and-place items, after Move to.
  const items = await labels(menu);
  expect(items.indexOf("Copy path")).toBe(items.indexOf("Move to…") + 1);
  await menu.getByRole("button", { name: "Copy path" }).click();
  await expect(menu).toHaveCount(0);
  await expect.poll(() => tab.evaluate(() => navigator.clipboard.readText())).toBe(`${project.root}/main.tex`);

  const folder = tab.getByRole("treeitem", { name: /figures/ }).first();
  await folder.click({ button: "right" });
  await tab.getByTestId("file-menu").getByRole("button", { name: "Copy path" }).click();
  await expect.poll(() => tab.evaluate(() => navigator.clipboard.readText())).toBe(`${project.root}/figures`);
});
