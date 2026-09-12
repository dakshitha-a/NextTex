import { test, expect } from "../fixtures";

/** R-081. Find and replace across the project, rather than inside one file. */

test("a string is found in files that are not open, and clicking goes there", async ({
  tab,
}) => {
  await expect(tab.locator(".cm-editor")).toBeVisible({ timeout: 30_000 });

  // Mod-Shift-F unfolds the rail, opens the panel and puts the caret in
  // the box, from wherever the keyboard was.
  await tab.locator(".cm-content").click();
  await tab.keyboard.press("Control+Shift+f");
  const box = tab.getByTestId("project-search");
  await expect(box).toBeFocused();

  // A word the shipped template has in a file that is not the one open.
  await box.fill("bibliography");
  await expect(tab.getByTestId("search-hit").first()).toBeVisible({
    timeout: 10_000,
  });
  const hit = tab.getByTestId("search-hit").first();
  const path = await hit.getAttribute("data-path");
  const line = await hit.getAttribute("data-line");
  await hit.click();

  // The file it named is now in front, at the line it named.
  await expect(tab.getByTitle(path!).first()).toBeVisible({ timeout: 10_000 });
  await expect(tab.getByText(/^Ln \d+, Col \d+$/)).toContainText(`Ln ${line}`, {
    timeout: 10_000,
  });
});

test("a bad pattern says so where it was typed", async ({ tab }) => {
  await expect(tab.locator(".cm-editor")).toBeVisible({ timeout: 30_000 });
  await tab.keyboard.press("Control+Shift+f");
  await tab.getByTestId("search-regex").click();
  await tab.getByTestId("project-search").fill("(unclosed");
  await expect(tab.getByTestId("search-problem")).toContainText("not a pattern", {
    timeout: 10_000,
  });
});

test("replacing everywhere is asked about first, and says what the undo is", async ({
  tab,
}) => {
  await expect(tab.locator(".cm-editor")).toBeVisible({ timeout: 30_000 });
  await tab.keyboard.press("Control+Shift+f");
  await tab.getByTestId("project-search").fill("bibliography");
  await expect(tab.getByTestId("search-hit").first()).toBeVisible({
    timeout: 10_000,
  });

  await tab.getByTestId("search-replace-toggle").click();
  await tab.getByTestId("project-replace").fill("BIBLIOGRAPHY");
  await tab.getByTestId("search-replace-all").click();
  // The confirmation says where the work goes if this was a mistake.
  await expect(tab.getByText(/keeps a version in its history/)).toBeVisible();
  await tab.getByTestId("search-replace-confirm").click();

  await expect(tab.getByTestId("search-summary")).toContainText("Nothing found", {
    timeout: 15_000,
  });
  await tab.getByTestId("project-search").fill("BIBLIOGRAPHY");
  await expect(tab.getByTestId("search-hit").first()).toBeVisible({
    timeout: 10_000,
  });
});
