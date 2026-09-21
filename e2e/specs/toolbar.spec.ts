import { test, expect } from "../fixtures";

/** Getting a copy out, and the strip's word count.
 *
 *  The downloads were a menu under a button on the title bar; they are
 *  the Download drawer on the bar since the frame run, one block per
 *  document with a chip per format.
 */

test("the downloads are a drawer on the bar, one block per document", async ({
  app, project, tab,
}) => {
  await expect(tab.locator(".cm-editor")).toBeVisible({ timeout: 45_000 });
  // A second document, not on the preview strip: it is listed all the
  // same, because every root .tex has a PDF of its own.
  await fetch(`${app.base}/api/projects/${project.id}/file`, {
    method: "PUT",
    headers: { "content-type": "application/json", "x-nexttex-token": app.token },
    body: JSON.stringify({
      path: "variants/acme.tex",
      text: "\\documentclass{article}\n\\begin{document}\nAcme.\n\\end{document}\n",
      compile: false, create: true,
    }),
  });

  // Nothing about downloads on the name row any more.
  await expect(tab.getByTestId("title-bar").getByText(/download/i)).toHaveCount(0);
  await expect(tab.getByTestId("download-panel")).toHaveCount(0);
  await tab.getByTestId("bar-download").click();

  const panel = tab.getByTestId("download-panel");
  await expect(panel).toBeVisible();
  await expect(panel.getByTestId("download-zip")).toBeVisible();
  // The project's block and two documents' blocks, each named by its
  // stem, each with a chip per format that says what lands in the folder.
  const rows = panel.getByTestId("download-row");
  await expect(rows).toHaveCount(3, { timeout: 10_000 });
  await expect(rows.nth(0)).toContainText("Whole project");
  await expect(rows.nth(0)).toContainText(/\d+ files/);
  await expect(rows.nth(1)).toHaveAttribute("data-document", "main.tex");
  await expect(rows.nth(1)).toContainText("main");
  await expect(rows.nth(2)).toContainText("acme");
  await expect(panel.getByTestId("download-pdf")).toHaveCount(2);
  await expect(panel.getByTestId("download-zip")).toHaveText(".zip");
  await expect(panel.getByTestId("download-pdf").nth(1)).toHaveText(".pdf");
  // Export chips only where pandoc is, three per document block when it
  // is and none when it is not; `export.spec.ts` pins each case with a
  // server of its own, and this server takes whatever PATH has.
  const exports = await panel.getByTestId("download-export").count();
  expect([0, 6]).toContain(exports);
  await expect(rows.nth(0).getByTestId("download-export")).toHaveCount(0);

  // The previewed document's chips come alive with its build; the one
  // that was never built waits, saying so.
  await expect(rows.nth(1)).toHaveAttribute("data-built", "true", { timeout: 60_000 });
  await expect(rows.nth(1)).toContainText(/built \d+\.\d s/);
  await expect(rows.nth(2)).toContainText("not built yet");
  await expect(rows.nth(2).getByTestId("download-pdf")).toBeDisabled();
  await expect(rows.nth(1).getByTestId("download-pdf")).toBeEnabled();

  // Choosing the built document fetches its PDF, by its path, and the
  // drawer stays where it is.
  const requests: string[] = [];
  tab.on("request", (request) => {
    if (request.url().includes("/download")) requests.push(request.url());
  });
  await rows.nth(1).getByTestId("download-pdf").click();
  await expect.poll(() => requests.length).toBeGreaterThan(0);
  const url = new URL(requests[0]);
  expect(url.searchParams.get("format")).toBe("pdf");
  expect(url.searchParams.get("document")).toBe("main.tex");
  await expect(panel).toBeVisible();
});

test("a new document appears in the drawer as it is saved, and its chips wake with its build", async ({
  app, project, tab,
}) => {
  await expect(tab.locator(".cm-editor")).toBeVisible({ timeout: 45_000 });
  await tab.getByTestId("bar-download").click();
  const panel = tab.getByTestId("download-panel");
  await expect(panel.getByTestId("download-row")).toHaveCount(2, { timeout: 10_000 });
  // Saved from outside the window, as a collaborator or a script would:
  // the tree's scan finds it, and the drawer lists it without a reload.
  await fetch(`${app.base}/api/projects/${project.id}/file`, {
    method: "PUT",
    headers: { "content-type": "application/json", "x-nexttex-token": app.token },
    body: JSON.stringify({
      path: "letter.tex",
      text: "\\documentclass{article}\n\\begin{document}\nDear editor.\n\\end{document}\n",
      compile: false, create: true,
    }),
  });
  const letter = panel.locator('[data-testid="download-row"][data-document="letter.tex"]');
  await expect(letter).toBeVisible({ timeout: 20_000 });
  await expect(letter).toContainText("not built yet");
  await expect(letter.getByTestId("download-pdf")).toBeDisabled();
  // Previewing it builds it, and the chips come alive.
  await tab.getByTestId("add-preview").click();
  await tab.getByRole("menuitem", { name: "letter.tex" }).click();
  await expect(letter).toHaveAttribute("data-built", "true", { timeout: 60_000 });
  await expect(letter.getByTestId("download-pdf")).toBeEnabled();
});

test("the icon buttons still say what they are", async ({ tab }) => {
  await expect(tab.locator(".cm-editor")).toBeVisible({ timeout: 45_000 });
  // A glyph with no accessible name is a button nobody navigating by name
  // can find. Sharing is the People drawer on the bar now, and the bar's
  // buttons say their names.
  await expect(tab.getByRole("button", { name: "People" })).toBeVisible();
  await expect(tab.getByTestId("bar-people")).toHaveAccessibleName("People");
  // The bibliography's drawer is called References, at the writer's word;
  // the code's id stays "papers".  The drawer's heading is the same word.
  await expect(tab.getByTestId("bar-papers")).toHaveAccessibleName("References");
  await tab.getByTestId("bar-papers").click();
  await expect(tab.getByTestId("drawer").getByText("References", { exact: true }).first()).toBeVisible();
  await expect(tab.getByTestId("drawer")).not.toContainText("Papers");
});

test("the word count says what it counted, and remembers", async ({ tab }) => {
  // R-100. The scope was plain `useState`, so a writer who counts their
  // chapter chose it again every session, and there were two scopes where
  // the two a writer asks about most are a selection and the section they
  // are in.
  // The status strip drops the count below a 640px pane, deliberately, and
  // the editor half of a default window is narrower than that. The rail
  // and the agent panel go away rather than the window growing, because a
  // remembered pane width survives a resize and would not give the room
  // back.
  await expect(tab.locator(".cm-editor")).toBeVisible({ timeout: 45_000 });
  await tab.keyboard.press("Control+b");
  await tab.keyboard.press("Control+Alt+a");
  const count = tab.getByTestId("word-count");
  await expect(count).toBeVisible({ timeout: 60_000 });

  // Round the cycle to "in file" and leave it there.
  for (let press = 0; press < 4; press += 1) {
    if ((await count.innerText()).includes("in file")) break;
    await count.click();
    await tab.waitForTimeout(400);
  }
  await expect(count).toContainText("in file");

  await tab.reload();
  await expect(tab.locator(".cm-editor")).toBeVisible({ timeout: 45_000 });
  await tab.keyboard.press("Control+b");
  await tab.keyboard.press("Control+Alt+a");
  await expect(tab.getByTestId("word-count")).toContainText("in file", {
    timeout: 60_000,
  });
});

test("moving the caret does not re-count the document", async ({ tab }) => {
  // The scoped word count arrived with the cursor line, the outline, the
  // line count and the selection in its effect's dependencies, because
  // those are what the section and selection spans are computed from. The
  // span is what the count actually depends on, and in the two scopes a
  // writer leaves it on, document and file, there is no span at all: every
  // arrow key was a round trip that ran texcount over the whole project.
  await expect(tab.locator(".cm-editor")).toBeVisible({ timeout: 45_000 });
  await tab.keyboard.press("Control+b");
  await tab.keyboard.press("Control+Alt+a");
  await expect(tab.getByTestId("word-count")).toBeVisible({ timeout: 60_000 });
  // The first count, and any the reload behind it asked for, are not the
  // subject: the count is started here and the arrows come after it.
  await tab.waitForTimeout(1_500);

  let counted = 0;
  const watch = (request: { url(): string }) => {
    if (request.url().includes("/words")) counted += 1;
  };
  tab.on("request", watch);
  try {
    await tab.locator(".cm-content").click();
    for (let press = 0; press < 8; press += 1) {
      await tab.keyboard.press("ArrowDown");
    }
    await tab.waitForTimeout(1_500);
    // Clicking into the editor moves the caret, which is one legitimate
    // change of state; eight arrow keys after it must add nothing.
    expect(counted, "the caret moved and the document was counted again").toBeLessThan(2);
  } finally {
    tab.off("request", watch);
  }
});
