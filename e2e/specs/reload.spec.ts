import { test, expect } from "../fixtures";

/** Coming back.
 *
 *  A reload -- or a browser restoring yesterday's tabs -- used to land on
 *  the list of projects with no sign of which one had been open, let alone
 *  which files.  For an app somebody spends months inside, that is the
 *  difference between a tool and an errand.
 */

test("a reload comes back to the document, not the project list", async ({
  tab,
}) => {
  await expect(tab.locator(".cm-editor")).toBeVisible();
  await tab.reload();
  await expect(tab.locator(".cm-editor")).toBeVisible({ timeout: 20_000 });
});

test("the files that were open are open again, with the same one in front", async ({
  tab,
}) => {
  await tab.getByText("references.bib").first().click();
  await expect(tab.locator(".cm-content")).toContainText("@book{knuth1984", {
    timeout: 15_000,
  });

  await tab.reload();
  await expect(tab.locator(".cm-editor")).toBeVisible({ timeout: 20_000 });
  // Both tabs are back...
  await expect(tab.locator('[data-tab][data-path="main.tex"]')).toBeVisible({
    timeout: 15_000,
  });
  await expect(
    tab.locator('[data-tab][data-path="references.bib"] button[aria-current]'),
  ).toBeVisible();
  // ...and the one that was in front still is.
  await expect(tab.locator(".cm-content")).toContainText("@book{knuth1984");
});

test("a strip of three comes back whole", async ({ app, project, tab }) => {
  // More than two, because the restore adds the tabs in one go and opens
  // only the file that was in front -- with two open, a bug that dropped
  // every tab but the last would still look right.
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
  await tab.getByText("notes.tex").first().click({ timeout: 15_000 });
  await tab.getByText("references.bib").first().click();
  await expect(tab.locator(".cm-content")).toContainText("@book{knuth1984", {
    timeout: 15_000,
  });

  // Put the middle one in front, so the order and the active tab are two
  // separate claims.
  await tab.locator('[data-tab][data-path="notes.tex"] button').first().click();
  await expect(tab.locator(".cm-content")).toContainText("notes to myself");

  await tab.reload();
  await expect(tab.locator(".cm-editor")).toBeVisible({ timeout: 20_000 });
  await expect(tab.locator("[data-tab]")).toHaveCount(3, { timeout: 15_000 });
  // In the order they were left in.  Adding the active one last moved
  // whatever was being worked on to the far right on every reload.
  expect(
    await tab.locator("[data-tab]").evaluateAll((nodes) =>
      nodes.map((node) => node.getAttribute("data-path")),
    ),
  ).toEqual(["main.tex", "notes.tex", "references.bib"]);
  await expect(
    tab.locator('[data-tab][data-path="notes.tex"] button[aria-current]'),
  ).toBeVisible();

  // A tab that was not in front is a name until it is clicked: no buffer
  // was read for it, and clicking it reads one now.
  await tab
    .locator('[data-tab][data-path="references.bib"] button')
    .first()
    .click();
  await expect(tab.locator(".cm-content")).toContainText("@book{knuth1984");
});

test("leaving for the project list is remembered too", async ({ tab }) => {
  await tab.getByTestId("switch-project").click();
  await expect(tab.locator(".cm-editor")).toHaveCount(0);
  await tab.reload();
  // Deliberately left, so it stays left.
  await expect(tab.locator(".cm-editor")).toHaveCount(0);
});

test("a transcript survives a reload", async ({ tab }) => {
  const composer = tab.locator("textarea");
  await composer.fill("#script:reply\nWhat does a label do?");
  await tab.getByRole("button", { name: "Send" }).click();
  await expect(tab.getByText(/A label attaches a name/)).toBeVisible({
    timeout: 20_000,
  });

  await tab.reload();
  await expect(tab.getByText(/A label attaches a name/)).toBeVisible({
    timeout: 20_000,
  });
});
