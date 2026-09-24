import { test, expect } from "../fixtures";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/** Moving between the source and the page, and choosing which page.
 *
 *  SyncTeX is the reason a preview beside the source is worth more than a
 *  PDF in another window: the two halves are the same document, and either
 *  one can take you to the other.  It is also the feature most likely to
 *  break silently -- a missing .synctex.gz, a stale one, a build directory
 *  that moved -- because nothing about the page looks wrong when it does.
 */

test("double-clicking the page jumps to the line that set it", async ({ tab }) => {
  await expect(tab.locator("canvas").first()).toBeVisible({ timeout: 45_000 });

  // Somewhere in the body of the first page rather than a margin: the
  // abstract sits well inside it in every template build.
  const canvas = tab.locator("canvas").first();
  const box = (await canvas.boundingBox())!;
  await tab.mouse.dblclick(box.x + box.width / 2, box.y + box.height * 0.35);

  // Landing anywhere in the source is the claim; which line depends on
  // exactly which glyph was under the pointer, and asserting that would be
  // asserting the typesetting rather than the navigation.
  await expect
    .poll(
      async () =>
        Number(
          (await tab.getByText(/^Ln \d+, Col \d+$/).innerText()).match(
            /Ln (\d+)/,
          )?.[1] ?? 0,
        ),
      { timeout: 20_000 },
    )
    .toBeGreaterThan(1);
});

test("double-clicking a word lands the cursor on that word", async ({ tab }) => {
  await expect(tab.locator("canvas").first()).toBeVisible({ timeout: 45_000 });
  await expect(tab.locator(".nx-text-layer span").first()).toBeAttached({
    timeout: 45_000,
  });

  // A word long enough to be worth searching for, taken from the page
  // itself so this does not depend on the template's exact wording -- and
  // measured with a Range, so the click lands in the middle of the word
  // rather than on the space in front of it. Aiming at the left edge of
  // the span selects that space, and a space is not a word.
  const picked = await tab.evaluate(() => {
    for (const span of document.querySelectorAll(".nx-text-layer span")) {
      const text = span.textContent ?? "";
      const match = text.match(/[A-Za-z]{7,}/);
      const node = span.firstChild;
      if (!match || match.index === undefined || !node) continue;
      const range = document.createRange();
      range.setStart(node, match.index);
      range.setEnd(node, match.index + match[0].length);
      const box = range.getBoundingClientRect();
      if (box.width < 4) continue;
      return {
        word: match[0],
        x: box.x + box.width / 2,
        y: box.y + box.height / 2,
      };
    }
    return null;
  });
  expect(picked).not.toBeNull();

  await tab.mouse.dblclick(picked!.x, picked!.y);

  const at = async () => {
    const text = await tab.getByText(/^Ln \d+, Col \d+$/).innerText();
    const found = text.match(/Ln (\d+), Col (\d+)/);
    return { line: Number(found?.[1] ?? 0), column: Number(found?.[2] ?? 0) };
  };

  // SyncTeX reports `Column:-1` for every query on every engine, so before
  // the word was used to refine it the cursor could only ever arrive at
  // column 1 -- near the sentence that was clicked, never in it.
  await expect.poll(async () => (await at()).line, { timeout: 20_000 })
    .toBeGreaterThan(1);
  const landed = await at();
  expect(landed.column).toBeGreaterThan(1);

  // And it is that word, not merely somewhere along the line: the editor
  // is asked what it has under the cursor.
  const under = await tab.evaluate(
    ({ column, word }) => {
      const line = document.querySelector(".cm-activeLine")?.textContent ?? "";
      return line.slice(column - 1, column - 1 + word.length);
    },
    { column: landed.column, word: picked!.word },
  );
  expect(under.toLowerCase()).toBe(picked!.word.toLowerCase());
});

test("the source can send the reader to its place on the page", async ({ tab }) => {
  await expect(tab.locator("canvas").first()).toBeVisible({ timeout: 45_000 });

  await tab.locator(".cm-content").click();
  await tab.keyboard.press("Control+End");
  // Scoped to the editor.  The preview's text is selectable now, so the
  // same words exist twice on screen -- once in the source and once in the
  // text layer over the page -- and an unscoped match finds both.
  await tab.locator(".cm-content").getByText("What the results mean").click();
  await tab.keyboard.press("Control+Enter");

  // The answer is a flash drawn over the page, which is the only thing a
  // reader actually sees: a line number would prove nothing about whether
  // the right part of the page was found.
  await expect(tab.locator(".nx-flash").first()).toBeVisible({ timeout: 20_000 });
});

test("a document's row menu offers its PDF, and a chapter's does not", async ({
  app, project, tab,
}) => {
  // There is no main document to set.  A standalone file is a document
  // with a PDF of its own the moment it exists; a chapter's PDF is its
  // parent's, so the item is not there to fail.
  for (const [path, text] of [
    ["standalone.tex", "\\documentclass{article}\n\\begin{document}\nOn its own.\n\\end{document}\n"],
    ["chapter.tex", "A chapter with no preamble.\n"],
  ]) {
    await fetch(`${app.base}/api/projects/${project.id}/file`, {
      method: "PUT",
      headers: { "content-type": "application/json", "x-nexttex-token": app.token },
      body: JSON.stringify({ path, text, compile: false, create: true }),
    });
  }

  const row = tab.getByLabel("Actions for standalone.tex");
  await expect(row).toBeVisible({ timeout: 15_000 });
  await row.click();
  const requests: string[] = [];
  tab.on("request", (request) => {
    if (request.url().includes("/download")) requests.push(request.url());
  });
  await tab.getByRole("button", { name: "Download PDF" }).click();
  await expect.poll(() => requests.length).toBeGreaterThan(0);
  expect(requests[0]).toContain("format=pdf");
  expect(requests[0]).toContain(`document=${encodeURIComponent("standalone.tex")}`);

  await tab.getByLabel("Actions for chapter.tex").click();
  await expect(tab.getByTestId("file-menu")).toBeVisible();
  await expect(tab.getByRole("button", { name: "Download PDF" })).toHaveCount(0);
});

test("a document that typesets nothing offers something that works", async ({
  app, tab,
}) => {
  // The worst first minute this app can give somebody is a blank grey
  // rectangle with no explanation.  An empty document produces no pages,
  // which is not an error and looks exactly like a broken preview.
  //
  // A project of its own, never built: overwriting main.tex in one that
  // has already compiled leaves the old PDF on disk, and the preview goes
  // on showing it.
  const root = join(app.projects, `blank-${Date.now()}`);
  mkdirSync(root, { recursive: true });
  writeFileSync(
    join(root, "main.tex"),
    "\\documentclass{article}\n\\begin{document}\n\\end{document}\n",
  );
  const made = await fetch(`${app.base}/api/projects`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-nexttex-token": app.token,
    },
    body: JSON.stringify({ path: root }),
  }).then((r) => r.json());
  expect(made.id).toBeTruthy();

  await tab.getByTestId("switch-project").click();
  await tab.getByText(root.split("/").pop()!, { exact: false }).first().click();

  await expect(tab.getByText(/nothing has been typeset yet/i)).toBeVisible({
    timeout: 45_000,
  });
  await tab.getByRole("button", { name: "Load a basic document" }).click();

  // And what it loads is a real document, not a placeholder: it typesets.
  await expect(tab.locator("canvas").first()).toBeVisible({ timeout: 45_000 });
  await expect(tab.getByText(/nothing has been typeset yet/i)).toHaveCount(0);
});

test("the browser tab names the project while it is open", async ({ project, tab }) => {
  // Every tab said "NextTex", so a row of them told you nothing about
  // which paper was in which.  The name goes first because a tab truncates
  // from the end.
  const name = project.root.split("/").pop()!;
  await expect(tab).toHaveTitle(`${name} · NextTex`);
  await tab.getByTestId("switch-project").click();
  await expect(tab.getByText(name, { exact: false }).first()).toBeVisible();
  await expect(tab).toHaveTitle("NextTex");
});

test("the page follows your typing to where you are writing", async ({ tab }) => {
  // Asked for after the first pass deliberately left it out. The rule that
  // makes it bearable is the gentle one: it moves only when the part of the
  // page you are writing on is not already in front of you, so working down
  // a page you are looking at moves nothing.
  await expect(tab.locator("canvas").first()).toBeVisible({ timeout: 45_000 });

  // Down to the end of the document, where the page on screen is not, and
  // type something so the build is one this person caused.
  await tab.locator(".cm-content").click();
  await tab.keyboard.press("Control+End");
  await tab.keyboard.press("ArrowUp");
  await tab.keyboard.press("End");
  await tab.keyboard.type(" A sentence near the end of the document.");

  // The answer is a flash drawn over the page, for the reason the spec
  // above gives: a page number proves nothing about whether the right part
  // of the page was found.
  await expect(tab.locator(".nx-flash").first()).toBeVisible({
    timeout: 45_000,
  });
});

test("a build nobody typed for leaves the page alone", async ({ tab }) => {
  // The other half, and the one that keeps section 6's anti-jump rule: a
  // rebuild the writer asked for explicitly, while they are reading rather
  // than writing, must not move the page under them.
  await expect(tab.locator("canvas").first()).toBeVisible({ timeout: 45_000 });
  // Past the window in which a keystroke counts as recent.
  await tab.waitForTimeout(3500);

  await tab.keyboard.press("Control+s");
  await tab.waitForTimeout(4000);
  await expect(tab.locator(".nx-flash")).toHaveCount(0);
});

test("the verb row does not follow you to another file", async ({ tab }) => {
  // R-069, the half that reproduces. `setState` does not fire the update
  // listener, so nothing floating over the editor was told about a swap:
  // a row of verbs offering to rewrite a paragraph in the file you just
  // left hung over the one you opened, and pressing it sent the agent at
  // a selection that is not there any more.
  await tab.locator(".cm-content").click();
  await tab.keyboard.press("Control+Home");
  await tab.keyboard.press("Shift+ArrowDown");
  await tab.keyboard.press("Shift+ArrowDown");
  await expect(tab.getByTestId("selection-actions")).toBeVisible({
    timeout: 20_000,
  });

  await tab.getByTestId("new-file").click();
  await tab.keyboard.type("second");
  await tab.keyboard.press("Enter");
  await expect(tab.locator('[data-tab][data-path="second.tex"]')).toBeVisible({
    timeout: 20_000,
  });

  await expect(
    tab.getByTestId("selection-actions"),
    "the verbs for the previous file are still over this one",
  ).toHaveCount(0);
});

test("a file can be opened by name without touching the mouse", async ({ tab }) => {
  // R-082. Every piece of a quick-open was built and none of them had a
  // key: the filter row, the search behind it, and Enter opening the first
  // match. Reaching it meant taking a hand off the keyboard, finding the
  // rail, unfolding Files if it was folded, and pressing a magnifier.
  await expect(tab.locator(".cm-editor")).toBeVisible({ timeout: 30_000 });
  await tab.locator(".cm-content").click();

  await tab.keyboard.press("Control+Alt+o");
  const box = tab.getByTestId("file-search");
  await expect(box).toBeFocused();

  await box.fill("references");
  await tab.keyboard.press("Enter");
  await expect(tab.getByTitle("references.bib").first()).toBeVisible({
    timeout: 10_000,
  });
});

test("the tab strip answers the keyboard, including the tab just closed", async ({
  tab,
}) => {
  // R-083. Every tab change was a trip to the strip with the mouse, and a
  // tab closed by mistake could not be brought back, though `afterClosing`
  // has always handed back the path it closed and both callers threw it
  // away.
  await expect(tab.locator(".cm-editor")).toBeVisible({ timeout: 30_000 });

  // Two files open, so there is a strip to walk.
  await tab.keyboard.press("Control+Alt+o");
  await tab.getByTestId("file-search").fill("references");
  await tab.keyboard.press("Enter");
  await expect(tab.getByTitle("references.bib").first()).toBeVisible({
    timeout: 10_000,
  });

  // The brackets, not the arrows: `Ctrl-Alt-Left` and `Ctrl-Alt-Right`
  // are GNOME's switch-to-workspace keys and a Mac browser's own previous
  // and next tab, and neither of those exists in a headless browser, so
  // the arrows passed here and did nothing on either desktop.
  await tab.locator(".cm-content").click();
  await tab.keyboard.press("Control+Alt+BracketLeft");
  // The tab in front, not merely a tab that is on the strip: main.tex is
  // visible either way, and the first version of this asserted that.  On
  // the source strip: the preview strip always has a tab in front too.
  await expect(tab.locator('[data-tab] [aria-current="true"]')).toHaveAttribute(
    "title",
    /main\.tex/,
  );

  // Close it from the keyboard, and bring it back.
  await tab.keyboard.press("Control+Alt+BracketRight");
  await expect(tab.locator('[data-tab] [aria-current="true"]')).toHaveAttribute(
    "title",
    /references\.bib/,
  );
  await tab.keyboard.press("Control+Alt+w");
  await expect(tab.getByTitle("references.bib")).toHaveCount(0, {
    timeout: 10_000,
  });
  await tab.keyboard.press("Control+Alt+Shift+T");
  await expect(tab.getByTitle("references.bib").first()).toBeVisible({
    timeout: 10_000,
  });
});

test("F8 walks the errors without a mouse", async ({ tab }) => {
  // R-094. The drawer answered nothing but a click, and a writer fixing a
  // build reads the list once and then works down it.
  // The same keystrokes `a11y.spec.ts` and `layout.spec.ts` use to earn an
  // error, rather than a variation: Control+End puts the caret after
  // \end{document}, where the engine ignores everything, so a broken
  // command typed there never reaches a build at all.
  await expect(tab.locator(".cm-editor")).toBeVisible({ timeout: 30_000 });
  await tab.locator(".cm-content").click();
  await tab.keyboard.press("End");
  await tab.keyboard.type("\n\\badcommand{x}\n\\anotherbad{y}\n");

  const status = tab.getByTestId("status");
  await expect(status).toHaveAttribute("data-state", /error|warn/, {
    timeout: 40_000,
  });

  // F8 with the drawer shut opens it, rather than jumping to something
  // the writer cannot see. It may already be open here, which is the
  // other half of the same rule and needs no assertion of its own.
  await tab.keyboard.press("F8");
  await expect(tab.getByTestId("diagnostics")).toBeVisible();

  // And it chose one: the selection bar is drawn on exactly one row,
  // which is the difference between stepping and merely opening.
  await expect(tab.getByTestId("diagnostic-copy").first()).toBeVisible();
  // Scoped to the drawer: the tree's active row carries the kit's
  // data-selected as well.
  const selected = tab.getByTestId("diagnostics").locator('[data-selected="true"]');
  await expect(selected).toHaveCount(1);

  await tab.keyboard.press("F8");
  await expect(selected).toHaveCount(1);
});

test("the caret readout belongs to the file on screen", async ({ tab }) => {
  // R-069, the third thing it named, left in the backlog by the fix run.
  // `setState` does not fire the update listener, so the line and column
  // in the strip stayed where the caret was in the file just left until
  // the next keystroke moved it. And the keystroke after the swap must
  // still reach the readout, which is the half the first attempt broke.
  await expect(tab.locator(".cm-editor")).toBeVisible({ timeout: 30_000 });
  // The document, not the frame: the editor is drawn before main.tex has
  // arrived, and a Ctrl-End into the empty view it holds meanwhile lands
  // on line 1, which is where this spec failed once in fifty under load.
  await expect(tab.getByTestId("editor-host")).toHaveAttribute(
    "data-shown", "main.tex", { timeout: 30_000 },
  );
  const caret = tab.getByTestId("caret");
  await tab.locator(".cm-content").click();
  // The end of the file rather than a counted number of ArrowDowns: the
  // template's long lines wrap, and ArrowDown moves by what is on screen.
  await tab.keyboard.press("Control+End");
  await expect(caret).not.toHaveText(/^Ln 1, /);
  const parked = await caret.innerText();

  await tab.getByTestId("new-file").click();
  await tab.keyboard.type("second");
  await tab.keyboard.press("Enter");
  await expect(tab.locator('[data-tab][data-path="second.tex"]')).toBeVisible({
    timeout: 20_000,
  });
  // The tab, and then the document. They are different moments: the tab
  // is drawn from the strip's state the moment the file is made, while
  // the view keeps the file it had until `openBuffer` has connected and
  // waited for the shared document. This spec read `Ln 1, Col 2` once,
  // having typed three characters, because it went on while the view was
  // still holding main.tex.
  await expect(tab.getByTestId("editor-host")).toHaveAttribute(
    "data-shown", "second.tex", { timeout: 20_000 },
  );
  await expect(caret).toHaveText("Ln 1, Col 1");

  await tab.locator(".cm-content").click();
  await tab.keyboard.type("abc");
  await expect(caret).toHaveText("Ln 1, Col 4");

  // And back again: the parked caret of the first file, not line 1.
  await tab.locator('[data-tab][data-path="main.tex"]').click();
  await expect(caret).toHaveText(parked);
});

/** Headings, on a page after the first.
 *
 *  Body text landed on the right word and headings did not, and only on
 *  later pages, which is the shape of a bug in the page arithmetic and was
 *  not one.  Measured with `synctex edit` on a built document: a heading's
 *  synctex box ends at its baseline, so the lower part of the glyph box
 *  already belongs to the paragraph beneath it, and the word search that
 *  repairs a near miss then found the heading's word inside the
 *  `\label{sec:results}` on the next line, or at the start of the paragraph
 *  below, before it reached the `\section` line above.  Page one looked
 *  fine because "Introduction" rarely recurs in its own first paragraph.
 */
const HEADED = String.raw`\documentclass{article}
\begin{document}
\section{Introduction}
\label{sec:intro}
Introduction to the problem, which is set out over a page so that the
sections that follow land on the second page of the document.
\newpage
\section{Results}
\label{sec:results}
Results are shown below, and the word results recurs at once so that a
search that starts from this line finds it here first.

\subsection{Discussion of the results}
\label{sec:discussion}
Discussion of the results follows, and this paragraph too begins with the
word that heads it.
\end{document}
`;
const SECTION_LINE = HEADED.split("\n").findIndex((l) => l.startsWith("\\section{Results}")) + 1;
const SUBSECTION_LINE = HEADED.split("\n").findIndex((l) => l.startsWith("\\subsection{")) + 1;

async function withHeaded({ app, project, page }: any) {
  writeFileSync(join(project.root, "main.tex"), HEADED);
  await page.goto(`${app.base}/?token=${app.token}`);
  await page.getByText("Projects", { exact: false }).first().waitFor();
  const { openProject } = await import("../fixtures");
  await openProject(page, project.root);
  await expect(page.locator(".cm-editor")).toBeVisible({ timeout: 30_000 });
  await expect(page.locator(".nx-page")).toHaveCount(2, { timeout: 60_000 });
  // The second page's text layer is built only once it is on screen.
  await page.locator(".nx-page").nth(1).scrollIntoViewIfNeeded();
  await expect(
    page.locator(".nx-page").nth(1).locator(".nx-text-layer span", { hasText: "Results" }).first(),
  ).toBeAttached({ timeout: 30_000 });
}

/** The point at a fraction of the way down a heading's text-layer span,
 *  where `fraction` near 1 is the descender zone that reproduced the
 *  report. */
async function onHeading(page: any, text: string, fraction: number) {
  const span = page
    .locator(".nx-page").nth(1)
    .locator(".nx-text-layer span", { hasText: text }).first();
  const box = (await span.boundingBox())!;
  return { x: box.x + box.width * 0.6, y: box.y + box.height * fraction };
}

const caretLine = async (page: any) =>
  Number((await page.getByText(/^Ln \d+, Col \d+$/).innerText()).match(/Ln (\d+)/)?.[1] ?? 0);

test("double-clicking a section heading on the second page lands on its \\section line", async ({
  app, project, page,
}) => {
  await withHeaded({ app, project, page });
  const at = await onHeading(page, "Results", 0.85);
  await page.mouse.dblclick(at.x, at.y);
  await expect.poll(() => caretLine(page), { timeout: 20_000 }).toBe(SECTION_LINE);
});

test("double-clicking a subsection heading lands on its \\subsection line", async ({
  app, project, page,
}) => {
  await withHeaded({ app, project, page });
  const at = await onHeading(page, "Discussion", 0.85);
  await page.mouse.dblclick(at.x, at.y);
  await expect.poll(() => caretLine(page), { timeout: 20_000 }).toBe(SUBSECTION_LINE);
});

test("double-clicking a heading's number, which is no word to search for, still lands on the heading", async ({
  app, project, page,
}) => {
  await withHeaded({ app, project, page });
  // The number is set in its own span before the title, or at the start
  // of the title's span; either way the click goes at the left edge.
  const span = page
    .locator(".nx-page").nth(1)
    .locator(".nx-text-layer span", { hasText: /^2\s*$|^2\s+Results/ }).first();
  const box = (await span.boundingBox())!;
  await page.mouse.dblclick(box.x + 4, box.y + box.height * 0.85);
  await expect.poll(() => caretLine(page), { timeout: 20_000 }).toBe(SECTION_LINE);
});

test("with several documents previewed, a double-click opens the source of the one on screen", async ({
  app, project, page,
}) => {
  // The writer's own check: two documents, neither including the other,
  // and the page under the pointer belongs to the second.  The inverse
  // search has to be asked about that document, not the main one, or the
  // caret lands in main.tex on a line that set nothing here.
  const ESI = String.raw`\documentclass{article}
\begin{document}
Supplementary information, kept apart from the thesis.

The supplementary tables follow on this page.
\end{document}
`;
  writeFileSync(join(project.root, "esi.tex"), ESI);
  await page.goto(`${app.base}/?token=${app.token}`);
  await page.getByText("Projects", { exact: false }).first().waitFor();
  const { openProject } = await import("../fixtures");
  await openProject(page, project.root);
  await expect(page.locator(".cm-editor")).toBeVisible({ timeout: 30_000 });
  await page.getByTestId("add-preview").click();
  await page.getByRole("menuitem", { name: "esi.tex" }).click();
  await expect(page.getByTestId("preview-tab-esi.tex")).toHaveAttribute("aria-current", "true");
  // Something else in the editor, so the jump has somewhere to come from
  // that is not already the right file.  Not main.tex: the preview follows
  // the document you open, so opening it would put its page on screen.
  await page.locator('[role="tree"] [data-path="references.bib"]').click();
  await expect(
    page.locator('[data-tab][data-path="references.bib"] button[aria-current="true"]'),
  ).toBeVisible();
  await expect(page.getByTestId("preview-tab-esi.tex")).toHaveAttribute("aria-current", "true");

  const span = page.locator(".nx-text-layer span", { hasText: "tables" }).first();
  await expect(span).toBeAttached({ timeout: 60_000 });
  const picked = await span.evaluate((el) => {
    const node = el.firstChild!;
    const index = (el.textContent ?? "").indexOf("tables");
    const range = document.createRange();
    range.setStart(node, index);
    range.setEnd(node, index + "tables".length);
    const box = range.getBoundingClientRect();
    return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  });
  await page.mouse.dblclick(picked.x, picked.y);

  await expect(
    page.locator('[data-tab][data-path="esi.tex"] button[aria-current="true"]'),
  ).toBeVisible({ timeout: 20_000 });
  const line = ESI.split("\n").findIndex((l) => l.includes("supplementary tables")) + 1;
  await expect.poll(() => caretLine(page), { timeout: 20_000 }).toBe(line);
  const under = await page.evaluate(() =>
    document.querySelector(".cm-activeLine")?.textContent ?? "",
  );
  expect(under).toContain("supplementary tables");
});

test("a double-click into a chapter that is not open yet lands on its line", async ({
  app, project, page,
}) => {
  // Every earlier double-click test landed in a file that was already
  // open.  A chapter opened by the click itself was handed back before
  // the server's first sync had filled it, so the jump to line 3 was
  // clamped against a one-line document and the caret sat at the top of
  // the right file.
  const MAIN = String.raw`\documentclass{article}
\begin{document}
Hello from the main file.
\input{sec/one}
\end{document}
`;
  const ONE = String.raw`A sibling paragraph.

The keyword bravado appears only in the chapter file.
`;
  mkdirSync(join(project.root, "sec"), { recursive: true });
  writeFileSync(join(project.root, "main.tex"), MAIN);
  writeFileSync(join(project.root, "sec", "one.tex"), ONE);
  await page.goto(`${app.base}/?token=${app.token}`);
  await page.getByText("Projects", { exact: false }).first().waitFor();
  const { openProject } = await import("../fixtures");
  await openProject(page, project.root);
  await expect(page.locator(".cm-editor")).toBeVisible({ timeout: 30_000 });
  await page.mouse.dblclick(...(await wordOnPage(page, "bravado")));
  await expect(
    page.locator('[data-tab][data-path="sec/one.tex"] button[aria-current="true"]'),
  ).toBeVisible({ timeout: 20_000 });
  const line = ONE.split("\n").findIndex((l) => l.includes("bravado")) + 1;
  await expect.poll(() => caretLine(page), { timeout: 20_000 }).toBe(line);
  expect(await page.evaluate(() => document.querySelector(".cm-activeLine")?.textContent))
    .toContain("bravado");
});

/** The centre of one word on the rendered page, once its text layer is
 *  there. */
async function wordOnPage(page: any, word: string): Promise<[number, number]> {
  const span = page.locator(".nx-text-layer span", { hasText: word }).first();
  await expect(span).toBeAttached({ timeout: 60_000 });
  const picked = await span.evaluate((el: Element, wanted: string) => {
    const node = el.firstChild!;
    const index = (el.textContent ?? "").indexOf(wanted);
    const range = document.createRange();
    range.setStart(node, index);
    range.setEnd(node, index + wanted.length);
    const box = range.getBoundingClientRect();
    return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  }, word);
  return [picked.x, picked.y];
}

test("a document in a subfolder finds the file beside it, and a double-click opens that file", async ({
  app, project, page,
}) => {
  // The in-app agent found that a document at papers/a/paper.tex had its
  // \input resolved against the project root, so a file beside it was not
  // found and the build failed silently as far as the pane could tell.
  // The engine runs from the document's own directory now.  The page
  // existing at all is the first half of the claim; the double-click
  // landing in the sibling file is the second, because the log and the
  // synctex map now carry paths from that directory too.  Not main.tex,
  // because the jobname is the stem and the root document already builds
  // to main.pdf.
  const MAIN = String.raw`\documentclass{article}
\begin{document}
Hello from the subfolder.
\input{sec/one}
\end{document}
`;
  const ONE = String.raw`A sibling paragraph.

The keyword bravado appears only in the sibling file.
`;
  mkdirSync(join(project.root, "papers", "a", "sec"), { recursive: true });
  writeFileSync(join(project.root, "papers", "a", "paper.tex"), MAIN);
  writeFileSync(join(project.root, "papers", "a", "sec", "one.tex"), ONE);
  await page.goto(`${app.base}/?token=${app.token}`);
  await page.getByText("Projects", { exact: false }).first().waitFor();
  const { openProject } = await import("../fixtures");
  await openProject(page, project.root);
  await expect(page.locator(".cm-editor")).toBeVisible({ timeout: 30_000 });
  await page.getByTestId("add-preview").click();
  await page.getByRole("menuitem", { name: "papers/a/paper.tex" }).click();
  await expect(page.getByTestId("preview-tab-papers/a/paper.tex")).toHaveAttribute("aria-current", "true");

  await page.mouse.dblclick(...(await wordOnPage(page, "bravado")));

  await expect(
    page.locator('[data-tab][data-path="papers/a/sec/one.tex"] button[aria-current="true"]'),
  ).toBeVisible({ timeout: 20_000 });
  const line = ONE.split("\n").findIndex((l) => l.includes("bravado")) + 1;
  await expect.poll(() => caretLine(page), { timeout: 20_000 }).toBe(line);
});

/** An unnumbered heading at body size, which only its bold face marks.
 *
 *  `\paragraph{}` in the article class is run in, set at the body size and
 *  unnumbered, so neither reading the double-click had, larger than the
 *  running text or opening with a number, called it a heading, and the
 *  word search took the nearest line with the word in it. Each line under
 *  it says "Methods" again, which is where that search lands.
 */
const RUN_IN = String.raw`\documentclass{article}
\begin{document}
Some opening prose so that the page has a running size to measure
against, set in the body face over a couple of lines of text.

\paragraph{Methods}
Methods were chosen for the three solvents, and Methods recurs here
so that a search starting under the heading finds it first. Methods
appears on this line too, and on the next, Methods, once more.
\end{document}
`;
const PARAGRAPH_LINE = RUN_IN.split("\n").findIndex((l) => l.startsWith("\\paragraph{")) + 1;

test("double-clicking an unnumbered heading set at body size lands on its \\paragraph line", async ({
  app, project, page,
}) => {
  writeFileSync(join(project.root, "main.tex"), RUN_IN);
  await page.goto(`${app.base}/?token=${app.token}`);
  await page.getByText("Projects", { exact: false }).first().waitFor();
  const { openProject } = await import("../fixtures");
  await openProject(page, project.root);
  await expect(page.locator(".cm-editor")).toBeVisible({ timeout: 30_000 });
  const heading = page
    .locator(".nx-page").first()
    .locator(".nx-text-layer span", { hasText: /^Methods$/ }).first();
  await expect(heading).toBeAttached({ timeout: 60_000 });
  const box = (await heading.boundingBox())!;
  await page.mouse.dblclick(box.x + box.width * 0.5, box.y + box.height * 0.5);
  await expect.poll(() => caretLine(page), { timeout: 20_000 }).toBe(PARAGRAPH_LINE);
});
