import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { test, expect, openProject } from "../fixtures";

/** A Markdown file is previewed.
 *
 *  A `.md` in front of the editor puts its rendering on the preview
 *  strip, as a tab of its own after the documents, the way a `.py` puts
 *  its run there.  The text follows the keyboard a quarter of a second
 *  behind; a `.tex` in front puts the page back without closing the tab;
 *  closing the tab keeps it closed while the file is typed in, and it
 *  returns when the file next comes to the front.
 */

const NOTES = `# Reviewer notes

Some *emphasis*, some **weight**, and a \`command\`.

- one point
- another

> A quoted remark.

\`\`\`tex
\\section{Not rendered, shown}
\`\`\`
`;

test("opening a Markdown file renders it beside the editor, live", async ({
  app, project, page,
}) => {
  writeFileSync(join(project.root, "notes.md"), NOTES);
  await page.goto(`${app.base}/?token=${app.token}`);
  await page.getByText("Projects", { exact: false }).first().waitFor();
  await openProject(page, project.root);
  await expect(page.locator(".cm-editor")).toBeVisible({ timeout: 30_000 });

  await page.locator('[role="tree"] [data-path="notes.md"]').click();
  const view = page.getByTestId("markdown-view");
  await expect(view).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId("markdown-tab-notes.md")).toBeVisible();
  // Rendered, with its structure: a heading that is a heading, a list
  // that is a list, a quote, and code kept literal.
  await expect(view.getByRole("heading", { level: 1, name: "Reviewer notes" })).toBeVisible();
  await expect(view.locator("em")).toHaveText("emphasis");
  await expect(view.locator("strong")).toHaveText("weight");
  await expect(view.locator("li")).toHaveCount(2);
  await expect(view.locator("blockquote")).toContainText("A quoted remark.");
  await expect(view.locator("pre")).toContainText("\\section{Not rendered, shown}");
  // The page is behind it, not gone.
  await expect(page.getByTestId("page-behind-script")).toHaveClass(/hidden/);

  // Typing reaches the rendering a moment later.
  await page.locator(".cm-content").click();
  await page.keyboard.press("Control+End");
  await page.keyboard.type("\n## A new section\n");
  await expect(view.getByRole("heading", { level: 2, name: "A new section" })).toBeVisible({
    timeout: 10_000,
  });

  // A document in front puts the page back and keeps the tab.
  await page.locator('[role="tree"] [data-path="main.tex"]').click();
  await expect(page.getByTestId("page-behind-script")).not.toHaveClass(/hidden/);
  await expect(page.getByTestId("markdown-tab-notes.md")).toBeVisible();
  // And the tab brings the rendering forward again on its own.
  await page.getByTestId("markdown-tab-notes.md").click();
  await expect(view).toBeVisible();

  // Closing the tab closes it; the file in front does not reopen it by
  // being typed in, and reopening the file does.
  await page.locator('[role="tree"] [data-path="notes.md"]').click();
  await page.getByTestId("preview-strip").getByRole("button", { name: "Close notes.md" }).click();
  await expect(page.getByTestId("markdown-tab-notes.md")).toHaveCount(0);
  await expect(page.getByTestId("page-behind-script")).not.toHaveClass(/hidden/);
  await page.locator(".cm-content").click();
  await page.keyboard.type("still typing ");
  await page.waitForTimeout(600);
  await expect(page.getByTestId("markdown-tab-notes.md")).toHaveCount(0);
  await page.locator('[role="tree"] [data-path="main.tex"]').click();
  await page.locator('[role="tree"] [data-path="notes.md"]').click();
  await expect(page.getByTestId("markdown-tab-notes.md")).toBeVisible();
  await expect(view).toBeVisible();
});

test("choosing the Markdown tab brings its file to the source pane", async ({
  app, project, page,
}) => {
  // A document tab has always brought its file, through `showPreview`;
  // the Markdown tab only brought its rendering forward and left the
  // editor on whatever it had, so reading the notes meant a second
  // click in the tree to write in them.
  writeFileSync(join(project.root, "notes.md"), NOTES);
  await page.goto(`${app.base}/?token=${app.token}`);
  await page.getByText("Projects", { exact: false }).first().waitFor();
  await openProject(page, project.root);
  await expect(page.locator(".cm-editor")).toBeVisible({ timeout: 30_000 });
  await page.locator('[role="tree"] [data-path="notes.md"]').click();
  await expect(page.getByTestId("markdown-view")).toBeVisible({ timeout: 15_000 });
  await page.locator('[role="tree"] [data-path="main.tex"]').click();
  await expect(page.locator('[data-tab][data-path="main.tex"] [aria-current="true"]'))
    .toBeVisible();

  await page.getByTestId("markdown-tab-notes.md").click();
  await expect(page.getByTestId("markdown-view")).toBeVisible();
  await expect(page.locator('[data-tab][data-path="notes.md"] [aria-current="true"]'))
    .toBeVisible();
  await expect(page.locator(".cm-content")).toContainText("Reviewer notes");
  // And the document tab brings its own file back, as it always did.
  await page.getByTestId("preview-tab-main.tex").click();
  await expect(page.locator('[data-tab][data-path="main.tex"] [aria-current="true"]'))
    .toBeVisible();
});

test("double-clicking the rendering puts the caret on that word in the source", async ({
  app, project, page,
}) => {
  // The page has SyncTeX for this; the rendering knows its lines itself.
  // NOTES puts "weight" on line 3 at column 25, "another" on line 6 and
  // the code on line 11, so the claim can be exact where the page's
  // spec, which depends on the typesetting, cannot.
  writeFileSync(join(project.root, "notes.md"), NOTES);
  await page.goto(`${app.base}/?token=${app.token}`);
  await page.getByText("Projects", { exact: false }).first().waitFor();
  await openProject(page, project.root);
  await expect(page.locator(".cm-editor")).toBeVisible({ timeout: 30_000 });
  await page.locator('[role="tree"] [data-path="notes.md"]').click();
  const view = page.getByTestId("markdown-view");
  await expect(view.locator("strong")).toHaveText("weight", { timeout: 15_000 });

  const caret = () => page.getByText(/^Ln \d+, Col \d+$/).innerText();
  await view.locator("strong").dblclick();
  await expect.poll(caret).toBe("Ln 3, Col 25");

  await view.locator("li").nth(1).dblclick();
  await expect.poll(caret).toMatch(/^Ln 6, Col \d+$/);

  await view.locator("pre").dblclick();
  await expect.poll(caret).toMatch(/^Ln 11, Col \d+$/);

  // The caret is in the editor now, on the word, and the file is still
  // the one in front: nothing else moved.
  await expect(page.locator(".cm-content")).toBeFocused();
  await expect(page.locator('[data-tab][data-path="notes.md"] [aria-current="true"]'))
    .toBeVisible();
});

test("an empty Markdown file says so rather than showing a blank page", async ({
  app, project, page,
}) => {
  writeFileSync(join(project.root, "empty.md"), "");
  await page.goto(`${app.base}/?token=${app.token}`);
  await page.getByText("Projects", { exact: false }).first().waitFor();
  await openProject(page, project.root);
  await page.locator('[role="tree"] [data-path="empty.md"]').click();
  await expect(page.getByTestId("markdown-view")).toContainText("Nothing written yet.", {
    timeout: 15_000,
  });
});
