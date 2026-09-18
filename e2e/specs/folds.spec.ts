import { test, expect } from "../fixtures";
import { writeFileSync } from "node:fs";
import { join } from "node:path";

/** Sections and environments fold.
 *
 *  The ranges are a pure function with its own vitest, `frontend/src/folds.ts`;
 *  what only a browser can say is that the gutter draws a marker where a
 *  fold can start, that a click hides the lines and shows how many, that
 *  the section below stays, and that the keyboard does the same.
 */

const CHAPTER = [
  "\\section{One}",
  "First paragraph of one.",
  "Second paragraph of one.",
  "\\begin{itemize}",
  "\\item An item",
  "\\item Another item",
  "\\end{itemize}",
  "\\section{Two}",
  "The prose of two.",
  "",
].join("\n");

async function visibleLines(page: import("@playwright/test").Page): Promise<string[]> {
  return page.locator(".cm-line").allInnerTexts();
}

test("a section folds from the gutter and unfolds from its placeholder, and an environment folds too", async ({
  project, tab,
}) => {
  await expect(tab.locator(".cm-editor")).toBeVisible({ timeout: 45_000 });
  writeFileSync(join(project.root, "chapter.tex"), CHAPTER);
  await tab.getByText("chapter.tex").first().click({ timeout: 15_000 });
  await expect(tab.locator(".cm-content")).toContainText("First paragraph of one.");

  // A marker on the two section lines and on the itemize line, none on
  // prose: three, in document order.  The gutter draws one element per
  // line that can fold, and a hidden spacer first.
  const markers = tab.locator(".cm-foldGutter .cm-foldMarker:visible");
  await expect(markers).toHaveCount(3);

  // Fold "One": its prose and its list go, "Two" stays, and the
  // placeholder says how much is hidden.
  await markers.nth(0).click();
  await expect(tab.locator(".cm-foldPlaceholder")).toHaveText("6 lines");
  let lines = await visibleLines(tab);
  expect(lines[0]).toContain("\\section{One}");
  expect(lines.some((l) => l.includes("First paragraph"))).toBe(false);
  expect(lines.some((l) => l.includes("\\section{Two}"))).toBe(true);
  expect(lines.some((l) => l.includes("The prose of two"))).toBe(true);

  // The placeholder unfolds it.
  await tab.locator(".cm-foldPlaceholder").click();
  await expect(tab.locator(".cm-foldPlaceholder")).toHaveCount(0);
  await expect(tab.locator(".cm-content")).toContainText("First paragraph of one.");

  // The list folds on its own: its items go and its \end stays.
  await markers.nth(1).click();
  await expect(tab.locator(".cm-foldPlaceholder")).toHaveText("2 lines");
  lines = await visibleLines(tab);
  expect(lines.some((l) => l.includes("\\item An item"))).toBe(false);
  expect(lines.some((l) => l.includes("\\end{itemize}"))).toBe(true);
  expect(lines.some((l) => l.includes("First paragraph"))).toBe(true);
});

test("the keyboard folds the section the caret is in and unfolds it again", async ({
  project, tab,
}) => {
  await expect(tab.locator(".cm-editor")).toBeVisible({ timeout: 45_000 });
  writeFileSync(join(project.root, "chapter.tex"), CHAPTER);
  await tab.getByText("chapter.tex").first().click({ timeout: 15_000 });
  await expect(tab.locator(".cm-content")).toContainText("The prose of two.");
  await tab.locator(".cm-line", { hasText: "The prose of two." }).click();
  await tab.keyboard.press("Control+Shift+BracketLeft");
  await expect(tab.locator(".cm-foldPlaceholder")).toHaveText("1 lines");
  expect((await visibleLines(tab)).some((l) => l.includes("The prose of two"))).toBe(false);
  await tab.keyboard.press("Control+Shift+BracketRight");
  await expect(tab.locator(".cm-foldPlaceholder")).toHaveCount(0);
  await expect(tab.locator(".cm-content")).toContainText("The prose of two.");
});
