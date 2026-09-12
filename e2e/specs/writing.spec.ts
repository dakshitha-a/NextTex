import { test, expect } from "../fixtures";
import type { Page } from "@playwright/test";
import { watchEvents } from "../events";
import { landed } from "../typing";

/** The loop the whole app exists for: type, see it typeset, click back. */

async function waitForBuild(page: Page, action: () => Promise<void>) {
  const compiled = page.waitForResponse(
    (r) => r.url().includes("/pdf"),
    { timeout: 45_000 },
  );
  await action();
  await compiled;
}

test("typing lands on disk without being asked to", async ({ app, project, tab }) => {
  // There is no save request to wait for: a keystroke goes into the shared
  // document over a socket and the server writes the file from there. So
  // the assertion is the outcome rather than the mechanism, which is what
  // the old version was using the response as a stand-in for anyway.
  await tab.locator(".cm-content").click();
  await tab.keyboard.type("\nA sentence nobody asked me to save.");
  await landed(app, project, "A sentence nobody asked me to save.");
});

test("what is typed reaches the page", async ({ tab }) => {
  await waitForBuild(tab, async () => {
    await tab.locator(".cm-content").click();
    await tab.keyboard.type("\nA sentence that has to be typeset.");
  });
  // The preview draws to a canvas, so what is asserted is that a page
  // exists and the build reported no errors -- not the pixels.
  await expect(tab.locator("canvas").first()).toBeVisible({ timeout: 45_000 });
});

test("a mistake is marked in the margin, and the drawer stays shut", async ({
  tab,
}) => {
  await waitForBuild(tab, async () => {
    await tab.locator(".cm-content").click();
    await tab.keyboard.type("\n\\thisCommandDoesNotExist");
  });
  await expect(tab.locator(".cm-gutter-error").first()).toBeVisible({
    timeout: 45_000,
  });
  // Deliberate: a build fires while the writer is mid-equation, and having
  // the error list jump up over the document at that moment is the most
  // irritating thing this app can do.
  await expect(tab.getByText(/error/i).first()).toBeVisible();
  expect(await tab.locator("[data-drawer-open]").count()).toBe(0);
});

test("an unbalanced equation holds the build back until it is finished", async ({
  app, project, tab,
}) => {
  // A build fired mid-equation typesets a document with an unclosed $, so
  // the writer gets a screenful of errors about the sentence they are in
  // the middle of writing.  The debounce stretches from 1.6s to 4.0s until
  // the maths balances again.
  const status = tab.getByTestId("status");
  await expect
    .poll(async () => (await status.getAttribute("data-state")) !== "compiling",
          { timeout: 45_000 })
    .toBe(true);

  // Inside the body, and it matters: `mid_construct` looks only between
  // \begin{document} and \end{document}, because a package's braces in the
  // preamble are not somebody's unfinished sentence.  Clicking the editor
  // and typing lands in whatever is on screen, which is the preamble.
  await tab.locator(".cm-content").click();
  await tab.keyboard.press("Control+End");
  // Scoped to the editor. The same words are on the typeset page, and the
  // preview now renders before this line is reached, because the strip
  // says "compiling" through the first build instead of "ready" and the
  // poll above waits for it properly. An unscoped `getByText` matched the
  // source and the PDF's text layer and failed on strict mode.
  await tab.locator(".cm-content").getByText("What the results mean").click();
  await tab.keyboard.press("End");

  const events = await watchEvents(app, project.id);
  try {
    // The dollar pairs itself now, so a half-written equation has to be
    // made rather than typed: the closer the editor helpfully added is
    // deleted, which is what a writer does when they meant to open a
    // display, or paste one, or take a collaborator's half-line.
    await tab.keyboard.type("\nHalf an equation: $");
    await tab.keyboard.press("Delete");
    await tab.keyboard.type("x = ");
    // Past the ordinary debounce, well short of the unsettled one.
    await tab.waitForTimeout(2_500);
    expect(
      events.count("compile_start"),
      "a build started while the maths was still half-written",
    ).toBe(0);

    // Close it, and the ordinary debounce applies again.
    await tab.keyboard.type("1$");
    await expect
      .poll(() => events.count("compile_start"), { timeout: 15_000 })
      .toBeGreaterThan(0);
  } finally {
    events.stop();
  }
});

test("find and replace opens on the first press", async ({ tab }) => {
  await tab.locator(".cm-content").click();
  await tab.keyboard.press("Control+f");
  await expect(tab.locator(".cm-panel.cm-search")).toBeVisible();
  await expect(tab.locator(".cm-panel.cm-search input").first()).toBeFocused();
});

test("completion offers the project's own labels", async ({ tab }) => {
  await tab.locator(".cm-content").click();
  await tab.keyboard.press("Control+End");
  await tab.keyboard.type("\n\\ref{");
  await expect(tab.locator(".cm-tooltip-autocomplete")).toBeVisible({
    timeout: 10_000,
  });
  await expect(tab.locator(".cm-tooltip-autocomplete")).toContainText("eq:");
});

test("hovering an equation shows it typeset", async ({ tab }) => {
  // Written here rather than found in the template: CodeMirror only renders
  // the lines on screen, and typing scrolls the caret into view.
  await tab.locator(".cm-content").click();
  await tab.keyboard.press("Control+End");
  await tab.keyboard.type("\nA gap of $E = mc^2$ appears.");
  await expect(tab.locator(".cm-line", { hasText: "A gap of" })).toBeVisible();

  // The exact pixel of one character, since a .cm-line is as wide as the
  // pane and hovering the middle of it hovers empty space past the text.
  const point = await tab.evaluate(() => {
    const line = [...document.querySelectorAll(".cm-line")].find((el) =>
      el.textContent?.includes("A gap of"),
    );
    if (!line) return null;
    const target = line.textContent!.indexOf("mc^2") + 1;
    const walker = document.createTreeWalker(line, NodeFilter.SHOW_TEXT);
    let seen = 0;
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const length = node.textContent!.length;
      if (seen + length > target) {
        const range = document.createRange();
        range.setStart(node, target - seen);
        range.setEnd(node, target - seen + 1);
        const box = range.getBoundingClientRect();
        return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
      }
      seen += length;
    }
    return null;
  });
  expect(point).not.toBeNull();
  await tab.mouse.move(point!.x, point!.y);
  await tab.mouse.move(point!.x + 1, point!.y);
  await expect(tab.locator(".nx-math-tooltip")).toBeVisible({ timeout: 10_000 });
});

test("the two things a LaTeX writer types most now close themselves", async ({
  tab,
}) => {
  // R-092. `closeBrackets()` was installed with its default set, which is
  // ( [ { ' " and does not include the dollar, and a `\begin{figure}`
  // typed by hand never produced its `\end{figure}`: that happened only
  // when the completion list was used, which is the case where the writer
  // already knew the environment's name.
  await expect(tab.locator(".cm-editor")).toBeVisible({ timeout: 30_000 });
  await tab.locator(".cm-content").click();
  await tab.keyboard.press("Control+a");

  await tab.keyboard.type("The gap is $");
  await expect(tab.locator(".cm-content")).toContainText("The gap is $$");
  // The caret is between them, so what is typed next is the maths.
  await tab.keyboard.type("E");
  await expect(tab.locator(".cm-content")).toContainText("The gap is $E$");

  await tab.keyboard.press("Control+a");
  await tab.keyboard.type("  \\begin{itemize}");
  await tab.keyboard.press("Enter");
  await expect(tab.locator(".cm-content")).toContainText("\\end{itemize}");
  // And the caret is on the line between, indented to match, which is
  // where the writer was going to type anyway.
  await tab.keyboard.type("\\item first");
  const text = await tab.locator(".cm-content").innerText();
  expect(text.indexOf("\\item first")).toBeGreaterThan(text.indexOf("\\begin{itemize}"));
  expect(text.indexOf("\\item first")).toBeLessThan(text.indexOf("\\end{itemize}"));
});

test("a price is not turned into an equation", async ({ tab }) => {
  // The dollar was added to the closing-bracket set so a writer opening
  // maths gets the closer, and `closeBrackets` decides by what follows the
  // caret: at the end of a line there is nothing, so it pairs. A backslash
  // in front of it means the opposite of maths, and `\$100` was becoming
  // `\$100$` with a stray closer at the end of the price.
  await expect(tab.locator(".cm-editor")).toBeVisible({ timeout: 30_000 });
  await tab.locator(".cm-content").click();
  await tab.keyboard.press("Control+a");

  await tab.keyboard.type("It cost \\$100 in all.");
  // The whole line, not a substring: the closer lands after the price, so
  // `toContainText` matches either way.
  await expect
    .poll(async () => (await tab.locator(".cm-content").innerText()).trim())
    .toBe("It cost \\$100 in all.");

  // And a dollar that is not escaped still pairs, which is the other half
  // of the same decision.
  await tab.keyboard.press("Control+a");
  await tab.keyboard.type("A gap of $");
  await expect(tab.locator(".cm-content")).toContainText("A gap of $$");
});
