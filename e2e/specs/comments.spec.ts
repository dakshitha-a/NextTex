import { test, expect, openProject } from "../fixtures";
import type { Page } from "@playwright/test";

/** Comments: highlight text, choose Comment, and the thread lives on the
 *  text, beside the line number, in its own drawer, and in a second
 *  window, until somebody resolves it or deletes it.
 *
 *  Drawn on the direction page's Comments section and built from it. The
 *  editor is the thing under test, so the text is typed here and selected
 *  with the keyboard, the way a writer does.
 */

const SENTENCE = "The fast component is 180 fs in hexane.";

async function readyMain(page: Page) {
  await expect(page.getByTestId("editor-host")).toHaveAttribute(
    "data-shown", "main.tex", { timeout: 30_000 },
  );
}

/** Put the sentence at the end of main.tex and select its last word,
 *  "hexane", or as many characters before the full stop as `word` has. */
async function selectLastWord(page: Page, word = "hexane") {
  await page.locator(".cm-content").click();
  await page.keyboard.press("Control+End");
  await page.keyboard.press("Enter");
  await page.keyboard.type(SENTENCE);
  await page.keyboard.press("ArrowLeft"); // before the full stop
  for (let i = 0; i < word.length; i += 1) await page.keyboard.press("Shift+ArrowLeft");
}

async function comment(page: Page, body: string, word = "hexane") {
  await selectLastWord(page, word);
  const row = page.getByTestId("selection-actions");
  await expect(row).toBeVisible({ timeout: 10_000 });
  // A single word is too short for the agent's verbs, and gets Comment.
  await expect(row.getByTestId("selection-reword")).toHaveCount(0);
  await row.getByTestId("selection-comment").click();
  const composer = page.getByTestId("comment-composer");
  await expect(composer).toBeVisible();
  await expect(composer).toContainText(word);
  await composer.getByRole("textbox", { name: "Comment" }).fill(body);
  await page.keyboard.press("Control+Enter");
  await expect(composer).toHaveCount(0);
  await expect(page.locator(".cm-content .nx-comment")).toHaveText(word, { timeout: 10_000 });
}

test("a comment is made on a selection, washed, and marked beside its line", async ({ tab }) => {
  await readyMain(tab);
  await comment(tab, "Which solvent is the slow one?");
  await expect(tab.locator(".nx-comment-gutter .nx-comment-icon")).toHaveCount(1);

  // Resting on the text previews it, with nothing to press.
  await tab.locator(".cm-content .nx-comment").hover();
  const preview = tab.getByTestId("comment-preview");
  await expect(preview).toContainText("Which solvent is the slow one?");
  await expect(preview).toContainText("You");
  await expect(preview.getByRole("button")).toHaveCount(0);

  // A click opens the thread; a reply lands; Resolve takes it off the text.
  await tab.locator(".nx-comment-gutter .nx-comment-icon").click();
  const thread = tab.getByTestId("comment-thread");
  await expect(thread).toBeVisible();
  await expect(tab.locator(".cm-content .nx-comment-open")).toHaveCount(1);
  await thread.getByRole("textbox", { name: "Reply" }).fill("Water, 2.1 ps.");
  await thread.getByTestId("comment-reply").click();
  await expect(thread.getByTestId("comment-message")).toHaveCount(2);
  await thread.getByTestId("comment-resolve").click();
  await expect(tab.locator(".cm-content .nx-comment")).toHaveCount(0);
  await expect(tab.locator(".nx-comment-gutter .nx-comment-icon")).toHaveCount(0);
});

test("Ctrl Alt M comments on any selection", async ({ tab }) => {
  await readyMain(tab);
  await selectLastWord(tab);
  await tab.keyboard.press("Control+Alt+m");
  const composer = tab.getByTestId("comment-composer");
  await expect(composer).toBeVisible();
  await composer.getByRole("textbox", { name: "Comment" }).fill("Units in siunitx.");
  await composer.getByTestId("comment-post").click();
  await expect(tab.locator(".cm-content .nx-comment")).toHaveText("hexane", { timeout: 10_000 });
});

test("the drawer lists threads, takes you to one, archives the resolved, and deletes", async ({
  tab,
}) => {
  await readyMain(tab);
  await comment(tab, "Cite the hexane data.");
  // Somewhere else in the file, so the click has somewhere to take us from.
  await tab.keyboard.press("Control+Home");

  await tab.getByTestId("bar-comments").click();
  const rows = tab.getByTestId("comment-row");
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText("hexane");
  await expect(rows.first()).toContainText("Cite the hexane data.");
  await rows.first().click();
  await expect(tab.getByTestId("comment-thread")).toBeVisible({ timeout: 10_000 });
  await expect(tab.getByTestId("caret")).not.toHaveText(/^Ln 1, /);

  // Resolved goes to the archive, folded, and comes back with Reopen.
  await tab.keyboard.press("Escape");
  await rows.first().hover();
  await rows.first().getByTestId("comment-row-resolve").click();
  await expect(tab.getByTestId("comment-row")).toHaveCount(0);
  await tab.getByTestId("comments-resolved").click();
  const archived = tab.getByTestId("comment-row");
  await expect(archived).toHaveCount(1);
  await expect(archived.first()).toContainText("Resolved by you");
  await archived.first().hover();
  await archived.first().getByTestId("comment-row-reopen").click();
  await expect(tab.locator(".cm-content .nx-comment")).toHaveCount(1);

  // Delete asks once, because it takes other people's words with it.
  const row = tab.getByTestId("comment-row").first();
  await row.hover();
  await row.getByTestId("comment-row-delete").click();
  await row.getByTestId("comment-row-delete-confirm").click();
  await expect(tab.getByTestId("comments-empty")).toBeVisible();
  await expect(tab.locator(".cm-content .nx-comment")).toHaveCount(0);
});

test("a thread whose text is deleted stays in the drawer and says so", async ({ tab }) => {
  await readyMain(tab);
  await comment(tab, "Is this right?");
  // Delete the commented word and its line.
  await tab.locator(".cm-content .nx-comment").click();
  await tab.keyboard.press("Escape");
  await tab.keyboard.press("Home");
  await tab.keyboard.press("Shift+End");
  await tab.keyboard.press("Delete");
  await tab.getByTestId("bar-comments").click();
  await expect(tab.getByTestId("comment-row").first()).toContainText("Its text was deleted", {
    timeout: 10_000,
  });
});

test("a reply from a second window arrives in the first while it is open", async ({
  app, project, tab, browser,
}) => {
  await readyMain(tab);
  await comment(tab, "Second opinion?");

  const other = await browser.newPage();
  await other.goto(`${app.base}/?token=${app.token}`);
  await openProject(other, project.root);
  await readyMain(other);
  // To the end, where the sentence is: the editor draws only the lines on
  // screen, so text and marks below the fold are not in the page at all.
  await other.locator(".cm-content").click();
  await other.keyboard.press("Control+End");
  // Short of "hexane": the first window's caret is drawn there, with its
  // name, inside the text.
  await expect(other.locator(".cm-content")).toContainText("The fast component is 180 fs in", {
    timeout: 15_000,
  });
  await expect(other.locator(".cm-content .nx-comment")).toContainText("hexane", { timeout: 15_000 });
  await other.locator(".nx-comment-gutter .nx-comment-icon").click();
  const theirs = other.getByTestId("comment-thread");
  await theirs.getByRole("textbox", { name: "Reply" }).fill("Agreed, cite it.");
  await theirs.getByTestId("comment-reply").click();

  await tab.locator(".nx-comment-gutter .nx-comment-icon").click();
  await expect(tab.getByTestId("comment-thread").getByTestId("comment-message")).toHaveCount(2, {
    timeout: 10_000,
  });
  await expect(tab.getByTestId("comment-thread")).toContainText("Agreed, cite it.");
  await other.close();
});
