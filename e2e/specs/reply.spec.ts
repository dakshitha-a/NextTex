import { test, expect } from "../fixtures";

/** Reply to reviewers: the open comment threads become the points of a
 *  letter, each leading back to its text. */

test("the open comments become a reply letter whose points lead back to their text", async ({ tab }) => {
  await expect(tab.locator(".cm-editor")).toBeVisible({ timeout: 45_000 });
  // A comment on a word of the document, made the way a writer makes one.
  const editor = tab.locator(".cm-content");
  await editor.click();
  await tab.keyboard.press("Control+End");
  await tab.keyboard.type("\nThe solvent was hexane.");
  await tab.keyboard.press("Shift+Home");
  await tab.keyboard.press("Control+Alt+m");
  const composer = tab.getByTestId("comment-composer");
  await expect(composer).toBeVisible();
  await composer.getByRole("textbox", { name: "Comment" }).fill("Which solvent, really?");
  await composer.getByTestId("comment-post").click();
  await expect(tab.locator(".cm-content .nx-comment")).toBeVisible({ timeout: 10_000 });

  await tab.getByTestId("bar-comments").click();
  await tab.getByTestId("comments-reply-letter").click();
  // The letter is written and opened; its new point is at its foot, and
  // the editor draws only the lines on screen, so the end is gone to.
  await expect(tab.locator(".cm-content")).toContainText("Reply to the reviewers", { timeout: 15_000 });
  await tab.locator(".cm-content").click();
  await tab.keyboard.press("Control+End");
  await expect(tab.locator(".cm-line", { hasText: "\\point{Which solvent, really?}" })).toBeVisible({ timeout: 15_000 });
  const source = tab.locator(".cm-line", { hasText: "\\source{main.tex:" });
  await expect(source).toBeVisible();

  // A Ctrl-click on the place opens it.
  const box = (await source.boundingBox())!;
  await tab.keyboard.down("Control");
  await tab.mouse.click(box.x + 80, box.y + box.height / 2);
  await tab.keyboard.up("Control");
  await expect(tab.locator(".cm-activeLine")).toContainText("The solvent was hexane.");
});
