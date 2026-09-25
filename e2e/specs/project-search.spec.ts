import { test, expect } from "../fixtures";

/** R-081. Find and replace across the project, rather than inside one file. */

test("a string is found in files that are not open, and clicking goes there", async ({
  tab,
}) => {
  await expect(tab.locator(".cm-editor")).toBeVisible({ timeout: 30_000 });

  // Mod-Shift-F unfolds the rail, opens the panel and puts the caret in
  // the box, from wherever the keyboard was.
  await tab.locator(".cm-content").click();
  await tab.keyboard.press("Control+Shift+F");
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
  await tab.keyboard.press("Control+Shift+F");
  await tab.getByTestId("search-regex").click();
  await tab.getByTestId("project-search").fill("(unclosed");
  await expect(tab.getByTestId("search-problem")).toContainText("not a pattern", {
    timeout: 10_000,
  });
});

test("a pattern that runs too long says so, and the app keeps answering", async ({
  app, project, tab,
}) => {
  // Q-028: this pattern over this line once held the interpreter lock for
  // minutes and stopped every request on the install.
  const { writeFileSync } = await import("node:fs");
  const { join } = await import("node:path");
  writeFileSync(join(project.root, "evil.tex"), "a".repeat(34) + "!\n");
  await expect(tab.locator(".cm-editor")).toBeVisible({ timeout: 30_000 });
  await tab.keyboard.press("Control+Shift+F");
  await tab.getByTestId("search-regex").click();
  await tab.getByTestId("project-search").fill("(a|aa)+$");
  await expect(tab.getByTestId("search-problem")).toHaveText(
    "That pattern took too long, so the search stopped. A repeat inside a " +
      "repeat, such as (a+)+, can run for minutes on one line; try a simpler pattern.",
    { timeout: 10_000 },
  );
  const answer = await fetch(`${app.base}/api/instance`, {
    headers: { "x-nexttex-token": app.token },
  });
  expect(answer.ok).toBe(true);
  if (process.env.NEXTTEX_SHOT) {
    await tab.getByTestId("search-problem").locator("xpath=../..").screenshot({ path: process.env.NEXTTEX_SHOT });
  }
});

test("replacing everywhere is asked about first, and says what the undo is", async ({
  tab,
}) => {
  await expect(tab.locator(".cm-editor")).toBeVisible({ timeout: 30_000 });
  await tab.keyboard.press("Control+Shift+F");
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
