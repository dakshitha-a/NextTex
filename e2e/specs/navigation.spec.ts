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

test("a chapter can be made the document that gets typeset", async ({
  app, project, tab,
}) => {
  // A dissertation is one main file including many; the writer switches
  // which one is built when they want a chapter on its own.
  await fetch(`${app.base}/api/projects/${project.id}/file`, {
    method: "PUT",
    headers: {
      "content-type": "application/json",
      "x-nexttex-token": app.token,
    },
    body: JSON.stringify({
      path: "chapter.tex",
      text: "\\documentclass{article}\n\\begin{document}\nA chapter on its own.\n\\end{document}\n",
      compile: false,
      create: true,
    }),
  });

  const row = tab.getByLabel("Actions for chapter.tex");
  await expect(row).toBeVisible({ timeout: 15_000 });
  await row.click();
  await tab.getByRole("button", { name: "Set as main document" }).click();

  // The tree says which one it is, so nobody has to remember.
  await expect(
    tab.getByRole("treeitem", { name: /chapter\.tex/ }).getByText("main"),
  ).toBeVisible({ timeout: 15_000 });
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
