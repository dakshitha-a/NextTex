import { test, expect } from "../fixtures";
import { mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/** A deleted file's tab closes, from either side.
 *
 *  The writer's report: deleting a file that was open in a tab, from the
 *  tree or from disk, left a dead tab on the strip, bound to a document
 *  the manifest had trashed, until they closed it by hand.  The delete
 *  route and the watcher's deletion both say `gone` now, the way a rename
 *  says `renamed`, and the tabs at or under a gone path close through the
 *  same road as a click on their close button.
 */

const tabs = (tab: import("@playwright/test").Page) =>
  tab.locator("[data-tab]").evaluateAll((els) => els.map((e) => e.getAttribute("data-path")));

test("deleting an open file from the tree closes its tab, and the rest keep working", async ({
  app, project, tab,
}) => {
  await expect(tab.locator(".cm-editor")).toBeVisible({ timeout: 45_000 });
  writeFileSync(join(project.root, "notes.tex"), "\\section{Notes}\nSome notes.\n");
  await tab.getByText("notes.tex").first().click({ timeout: 15_000 });
  await expect(tab.locator(".cm-content")).toContainText("Some notes");
  expect(await tabs(tab)).toEqual(["main.tex", "notes.tex"]);

  await tab.getByLabel("Actions for notes.tex").click();
  await tab.getByRole("button", { name: "Move to trash" }).click();
  await expect.poll(() => tabs(tab)).toEqual(["main.tex"]);
  // The tab that is left is in front, shows its file, and still writes.
  await expect(tab.locator('[data-tab][data-path="main.tex"] [aria-current="true"]')).toBeVisible();
  await expect(tab.locator(".cm-content")).toContainText("A document to start writing in");
  await tab.locator(".cm-content").click();
  await tab.keyboard.press("Control+End");
  await tab.keyboard.type("Typed after the deletion.");
  await expect.poll(() => readFileSync(join(project.root, "main.tex"), "utf-8"), { timeout: 15_000 })
    .toContain("Typed after the deletion.");
});

test("a file deleted on disk closes its tab through the watcher, and a folder takes every tab under it", async ({
  app, project, tab,
}) => {
  await expect(tab.locator(".cm-editor")).toBeVisible({ timeout: 45_000 });
  mkdirSync(join(project.root, "chapters"), { recursive: true });
  writeFileSync(join(project.root, "chapters", "one.tex"), "\\section{One}\nFirst.\n");
  writeFileSync(join(project.root, "chapters", "two.tex"), "\\section{Two}\nSecond.\n");
  writeFileSync(join(project.root, "notes.tex"), "\\section{Notes}\nSome notes.\n");
  await tab.getByText("notes.tex").first().click({ timeout: 15_000 });
  await expect(tab.locator(".cm-content")).toContainText("Some notes");
  const folder = tab.locator('[role="tree"] [data-path="chapters"]');
  await folder.click({ timeout: 15_000 });
  await tab.getByText("one.tex").first().click();
  await expect(tab.locator(".cm-content")).toContainText("First");
  await tab.getByText("two.tex").first().click();
  await expect(tab.locator(".cm-content")).toContainText("Second");
  expect(await tabs(tab)).toEqual(["main.tex", "notes.tex", "chapters/one.tex", "chapters/two.tex"]);

  // rm from a shell: the watcher sees it and the tab goes.
  unlinkSync(join(project.root, "notes.tex"));
  await expect.poll(() => tabs(tab), { timeout: 20_000 })
    .toEqual(["main.tex", "chapters/one.tex", "chapters/two.tex"]);

  // A folder from the tree: both tabs under it go.
  await tab.getByLabel("Actions for chapters").click();
  await tab.getByRole("button", { name: "Move folder to trash" }).click();
  await expect.poll(() => tabs(tab), { timeout: 20_000 }).toEqual(["main.tex"]);
  await expect(tab.locator(".cm-content")).toContainText("A document to start writing in");
});
