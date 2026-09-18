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

  // Closing the tab closes it and its file with it, and the page is back;
  // opening the file again brings the rendering back.
  await page.locator('[role="tree"] [data-path="notes.md"]').click();
  await page.getByTestId("preview-strip").getByRole("button", { name: "Close notes.md" }).click();
  await expect(page.getByTestId("markdown-tab-notes.md")).toHaveCount(0);
  await expect(page.locator('[data-tab][data-path="notes.md"]')).toHaveCount(0);
  await expect(page.getByTestId("page-behind-script")).not.toHaveClass(/hidden/);
  await page.locator('[role="tree"] [data-path="notes.md"]').click();
  await expect(page.getByTestId("markdown-tab-notes.md")).toBeVisible();
  await expect(view).toBeVisible();
});

test("the file and its rendering close each other, and come back together", async ({
  app, project, page,
}) => {
  // The writer reported that closing the .md left its preview on the
  // strip and closing the preview left the file open.  A document's
  // preview and its files keep each other tidy; the rendering is one
  // file, so it and the file are one thing to close, in either direction,
  // and the reopen shortcut brings the pair back.
  writeFileSync(join(project.root, "notes.md"), NOTES);
  await page.goto(`${app.base}/?token=${app.token}`);
  await page.getByText("Projects", { exact: false }).first().waitFor();
  await openProject(page, project.root);
  await expect(page.locator(".cm-editor")).toBeVisible({ timeout: 30_000 });
  await page.locator('[role="tree"] [data-path="notes.md"]').click();
  await expect(page.getByTestId("markdown-tab-notes.md")).toBeVisible({ timeout: 15_000 });

  // Close the file: the rendering goes and the page is back.
  await page.getByTestId("source-strip").getByRole("button", { name: "Close notes.md" }).click();
  await expect(page.locator('[data-tab][data-path="notes.md"]')).toHaveCount(0);
  await expect(page.getByTestId("markdown-tab-notes.md")).toHaveCount(0);
  await expect(page.getByTestId("page-behind-script")).not.toHaveClass(/hidden/);
  await expect(page.locator('[data-tab][data-path="main.tex"] [aria-current="true"]'))
    .toBeVisible();

  // Reopen the closed tab: both come back.
  await page.locator(".cm-content").click();
  await page.keyboard.press("Control+Alt+Shift+T");
  await expect(page.locator('[data-tab][data-path="notes.md"] [aria-current="true"]'))
    .toBeVisible();
  await expect(page.getByTestId("markdown-tab-notes.md")).toBeVisible();
  await expect(page.getByTestId("markdown-view")).toBeVisible();

  // Close the rendering: the file goes with it.
  await page.getByTestId("preview-strip").getByRole("button", { name: "Close notes.md" }).click();
  await expect(page.getByTestId("markdown-tab-notes.md")).toHaveCount(0);
  await expect(page.locator('[data-tab][data-path="notes.md"]')).toHaveCount(0);
  await expect(page.locator('[data-tab][data-path="main.tex"] [aria-current="true"]'))
    .toBeVisible();
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

test("the rendering follows the caret while typing, and only then", async ({
  app, project, page,
}) => {
  // The page follows the caret after a build the writer's typing caused,
  // and moves only when the target is off screen.  The rendering does the
  // same on the text's own cadence: typing at the end of a long file
  // brings the last block into view; clicking into the editor without
  // typing moves nothing, which is the anti-jump case.
  const long = Array.from({ length: 80 }, (_, i) => `Paragraph ${i + 1} of the notes.`)
    .join("\n\n") + "\n";
  writeFileSync(join(project.root, "long.md"), long);
  await page.goto(`${app.base}/?token=${app.token}`);
  await page.getByText("Projects", { exact: false }).first().waitFor();
  await openProject(page, project.root);
  await expect(page.locator(".cm-editor")).toBeVisible({ timeout: 30_000 });
  await page.locator('[role="tree"] [data-path="long.md"]').click();
  const pane = page.getByTestId("markdown-scroll");
  await expect(pane.locator("p")).toHaveCount(80, { timeout: 15_000 });
  const scrollTop = () => pane.evaluate((el) => el.scrollTop);
  expect(await scrollTop()).toBe(0);

  // Type at the end: the rendering scrolls so the last block is in view.
  await page.locator(".cm-content").click();
  await page.keyboard.press("Control+End");
  await page.keyboard.type("\nThe last word.\n");
  await expect.poll(scrollTop, { timeout: 10_000 }).toBeGreaterThan(0);
  const last = pane.locator("p").last();
  await expect(last).toContainText("The last word.");
  await expect(last).toBeInViewport();

  // Back to the top to read, then a click into the editor with no typing:
  // the text did not change, so nothing moves.
  await pane.evaluate((el) => { el.scrollTop = 0; });
  await page.waitForTimeout(3_500);
  await page.locator(".cm-content").click({ position: { x: 30, y: 20 } });
  await page.waitForTimeout(600);
  expect(await scrollTop()).toBe(0);
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
