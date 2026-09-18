import { test, expect } from "../fixtures";

/** The tab strip's right-click menu.
 *
 *  The arithmetic behind "close the others" is a pure function with its own
 *  vitest, `frontend/src/tabs.ts`; what only a browser can say is that the
 *  gesture reaches it, that the menu appears where a right-click happened
 *  rather than clipped inside the strip's own scroll box, and that a
 *  duplicate lands somewhere the writer can actually see.
 */

/** Put three files on the strip, with `notes.tex` in front. */
async function threeOpen(app: any, project: any, tab: any) {
  await fetch(`${app.base}/api/projects/${project.id}/file`, {
    method: "PUT",
    headers: {
      "content-type": "application/json",
      "x-nexttex-token": app.token,
    },
    body: JSON.stringify({
      path: "notes.tex",
      text: "% notes to myself\n",
      compile: false,
      create: true,
    }),
  });
  await tab.getByText("references.bib").first().click({ timeout: 15_000 });
  await tab.getByText("notes.tex").first().click({ timeout: 15_000 });
  await expect(tab.locator("[data-tab]")).toHaveCount(3, { timeout: 15_000 });
}

const paths = (tab: any) =>
  tab
    .locator("[data-tab]")
    .evaluateAll((nodes: HTMLElement[]) =>
      nodes.map((node) => node.getAttribute("data-path")),
    );

test("the menu closes every tab but the one it was opened on", async ({
  app, project, tab,
}) => {
  await threeOpen(app, project, tab);
  await tab.locator('[data-tab][data-path="notes.tex"]').click({ button: "right" });
  await expect(tab.getByTestId("tab-menu")).toBeVisible();
  await tab.getByRole("menuitem", { name: "Close the others" }).click();

  await expect(tab.locator("[data-tab]")).toHaveCount(1);
  expect(await paths(tab)).toEqual(["notes.tex"]);
  await expect(
    tab.locator('[data-tab][data-path="notes.tex"] button[aria-current="true"]'),
  ).toBeVisible();
});

test("a tab that is not in front keeps its browser menu", async ({
  app, project, tab,
}) => {
  await threeOpen(app, project, tab);
  await tab.locator('[data-tab][data-path="main.tex"]').click({ button: "right" });
  // A count of nothing passes before anything could have been drawn, so the
  // gesture that *does* open the menu is performed afterwards: it proves the
  // selector is right and that a menu had time to appear, which is what
  // makes the first assertion mean something.
  await expect(tab.getByTestId("tab-menu")).toHaveCount(0);
  await tab.locator('[data-tab][data-path="notes.tex"]').click({ button: "right" });
  await expect(tab.getByTestId("tab-menu")).toBeVisible();
  await expect(
    tab.locator('[data-tab][data-path="main.tex"]'),
  ).toBeVisible();
});

test("close all to the right keeps the target and what is before it", async ({
  app, project, tab,
}) => {
  // The strip reads main.tex, references.bib, notes.tex, with notes.tex in
  // front.  From the middle tab, "to the right" closes only notes.tex and
  // brings the middle tab forward, since the one in front has gone.
  await threeOpen(app, project, tab);
  await tab.locator('[data-tab][data-path="references.bib"]').click();
  await tab.locator('[data-tab][data-path="references.bib"]').click({ button: "right" });
  await tab.getByRole("menuitem", { name: "Close all to the right" }).click();

  await expect(tab.locator("[data-tab]")).toHaveCount(2);
  expect(await paths(tab)).toEqual(["main.tex", "references.bib"]);
  await expect(
    tab.locator('[data-tab][data-path="references.bib"] button[aria-current="true"]'),
  ).toBeVisible();

  // From the last tab there is nothing to the right, and the item says so.
  await tab.locator('[data-tab][data-path="references.bib"]').click({ button: "right" });
  await expect(tab.getByRole("menuitem", { name: "Close all to the right" })).toBeDisabled();
  await tab.keyboard.press("Escape");
});

test("the menu downloads the file in front", async ({ app, project, tab }) => {
  await threeOpen(app, project, tab);
  await tab.locator('[data-tab][data-path="notes.tex"]').click({ button: "right" });
  const waiting = tab.waitForEvent("download");
  await tab.getByRole("menuitem", { name: "Download" }).click();
  const download = await waiting;
  expect(download.suggestedFilename()).toBe("notes.tex");
  const { readFileSync } = await import("node:fs");
  expect(readFileSync((await download.path())!, "utf-8")).toBe("% notes to myself\n");
});

test("close all empties the strip", async ({ app, project, tab }) => {
  await threeOpen(app, project, tab);
  await tab.locator('[data-tab][data-path="notes.tex"]').click({ button: "right" });
  await tab.getByRole("menuitem", { name: "Close all", exact: true }).click();
  await expect(tab.locator("[data-tab]")).toHaveCount(0);
});

test("a duplicate is made, and the tree opens far enough to show it", async ({
  app, project, tab,
}) => {
  // In a folder, and one the tree has not been asked to open: a copy that
  // lands inside a shut folder has, from where the writer is sitting, not
  // landed at all.
  await fetch(`${app.base}/api/projects/${project.id}/file`, {
    method: "PUT",
    headers: {
      "content-type": "application/json",
      "x-nexttex-token": app.token,
    },
    body: JSON.stringify({
      path: "chapters/two.tex",
      text: "\\section{Two}\n",
      compile: false,
      create: true,
    }),
  });
  // Opened from the Sections list would be the honest route; opening the
  // folder and clicking is the same end state and does not depend on the
  // document having an \include.
  const folder = tab.locator('[role="tree"] [data-path="chapters"]');
  await folder.waitFor({ timeout: 15_000 });
  if ((await folder.getAttribute("aria-expanded")) !== "true") await folder.click();
  await tab.getByText("two.tex").first().click({ timeout: 15_000 });
  await expect(
    tab.locator('[data-tab][data-path="chapters/two.tex"]'),
  ).toBeVisible({ timeout: 15_000 });
  // Shut it again, so the reveal has something to undo.
  await folder.click();
  await expect(
    tab.locator('[role="tree"] [data-path="chapters/two.tex"]'),
  ).toHaveCount(0);

  await tab
    .locator('[data-tab][data-path="chapters/two.tex"]')
    .click({ button: "right" });
  await tab.getByRole("menuitem", { name: "Duplicate" }).click();

  await expect(
    tab.locator('[role="tree"] [data-path="chapters/two (copy).tex"]'),
  ).toBeVisible({ timeout: 15_000 });
  // And it did not steal the pane: the original is still the tab in front.
  await expect(
    tab.locator('[data-tab][data-path="chapters/two.tex"] button[aria-current="true"]'),
  ).toBeVisible();
});
