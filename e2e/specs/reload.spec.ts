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
