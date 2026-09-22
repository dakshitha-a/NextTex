import { test, expect } from "../fixtures";
import type { Page } from "@playwright/test";
import { watchEvents } from "../events";
import { landed, textOf } from "../typing";

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

test("find counts its matches, steps through them, and replaces behind its own control", async ({ tab }) => {
  // The kit's panel: one field with the toggles inside it, "1 of N",
  // previous and next, Replace adding the second field, and the
  // library's keys throughout.
  await tab.locator(".cm-content").click();
  await tab.keyboard.press("Control+f");
  const panel = tab.locator(".cm-panel.cm-search");
  await expect(panel).toBeVisible();
  await expect(panel.locator("input[name=replace]")).toHaveCount(0);
  await tab.keyboard.type("section");
  const count = panel.locator(".nx-find-count");
  await expect(count).toContainText(/of \d+/);
  const said = (await count.textContent()) ?? "";
  const total = Number(said.split("of ")[1]);
  expect(total).toBeGreaterThan(1);
  // Enter steps forward from the caret, and the count says where the
  // selection is; the next Enter moves it on, and Previous brings it back.
  await tab.keyboard.press("Enter");
  await expect(count).toHaveText(new RegExp(`^\\d+ of ${total}$`));
  const first = (await count.textContent()) ?? "";
  await tab.keyboard.press("Enter");
  await expect(count).not.toHaveText(first);
  await panel.getByRole("button", { name: "Previous match" }).click();
  await expect(count).toHaveText(first);
  // Match case is a toggle inside the field, and it narrows the count.
  await panel.getByRole("button", { name: "Match case" }).click();
  await expect(panel.getByRole("button", { name: "Match case" })).toHaveAttribute("aria-pressed", "true");
  await tab.locator(".cm-panel.cm-search input[name=search]").fill("SECTION");
  await expect(count).toHaveText("No matches");
  await tab.locator(".cm-panel.cm-search input[name=search]").fill("section");
  // Replace adds the second field; Escape closes the whole panel.
  await panel.getByRole("button", { name: "Replace", exact: true }).first().click();
  await expect(panel.locator("input[name=replace]")).toBeVisible();
  await expect(panel.locator("input[name=replace]")).toBeFocused();
  await tab.keyboard.press("Escape");
  await expect(panel).toHaveCount(0);
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

test("Tab accepts the selected completion, as Enter does", async ({ tab }) => {
  // The completion keymap binds Enter alone. A writer whose hands know Tab
  // from every other editor pressed it and got an indent in front of the
  // half-typed command, with the list still open.
  await tab.locator(".cm-content").click();
  await tab.keyboard.press("Control+End");
  await tab.keyboard.type("\n\\secti");
  await expect(tab.locator(".cm-tooltip-autocomplete")).toBeVisible({
    timeout: 10_000,
  });
  await expect(
    tab.locator(".cm-tooltip-autocomplete li[aria-selected]"),
  ).toContainText("\\section");
  // CodeMirror refuses to accept a list younger than 75 ms
  // (`interactionDelay`), so a keypress that could not have been aimed at
  // it is not taken as one, and the clock restarts each time the list is
  // refilled, which the last keystroke's query does after the list is
  // already on screen. A person is slower than that; the test has to be
  // too, and there is nothing in the DOM that says the clock has run.
  await tab.waitForTimeout(400);
  await tab.keyboard.press("Tab");
  await expect(tab.locator(".cm-tooltip-autocomplete")).toHaveCount(0);
  // The whole line, anchored: an indent in front of the half-typed
  // command is what the bug produced, and `toContainText` trims.
  await expect(tab.locator(".cm-activeLine")).toHaveText(/^\\section\{title\}$/);
});

test("Tab with no completion open still indents", async ({ tab }) => {
  await tab.locator(".cm-content").click();
  await tab.keyboard.press("Control+End");
  await tab.keyboard.type("\nplain words");
  await expect(tab.locator(".cm-tooltip-autocomplete")).toHaveCount(0);
  await tab.keyboard.press("Home");
  await tab.keyboard.press("Tab");
  // `indentWithTab` puts the line's indentation in, whatever the unit is;
  // what matters is that the words are still there and something is in
  // front of them.
  await expect(tab.locator(".cm-activeLine")).toHaveText(/^\s+plain words$/);
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
  const measure = () => tab.evaluate(() => {
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
  // Measured and hovered again until the tooltip is there, rather than
  // one hover and a long wait.  The tooltip's box is made the moment
  // CodeMirror accepts the hover, with the source in it before KaTeX has
  // loaded, so a tooltip that has not appeared after the hover's 250 ms
  // is one CodeMirror refused: `hoverTooltip` checks that the pointer's
  // coordinates still resolve to the position it hovered, and a layout
  // that shifted between the measurement and the move, which the tier
  // saw twice under load, fails that check for good.  A writer moves the
  // mouse again; so does this.
  await expect.poll(async () => {
    const point = await measure();
    if (!point) return 0;
    await tab.mouse.move(point.x - 4, point.y);
    await tab.mouse.move(point.x, point.y);
    await tab.mouse.move(point.x + 1, point.y);
    await tab.waitForTimeout(450);
    return tab.locator(".nx-math-tooltip").count();
  }, { timeout: 10_000, intervals: [100] }).toBeGreaterThan(0);
  await expect(tab.locator(".nx-math-tooltip")).toBeVisible();
  // The rendered maths and nothing else once KaTeX has landed: the
  // source is in the editor under the card.
  const card = tab.locator(".nx-math-tooltip");
  await expect(card.locator(".katex")).toBeVisible({ timeout: 15_000 });
  await expect(card.locator(".nx-math-source")).toHaveCount(0);
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

test("a keystroke during a file swap cannot land in the file just left", async ({
  app, project, tab,
}) => {
  // Opening a file is three awaits long: connect to the collaboration
  // socket, open the shared document, wait for its first sync. The tab
  // for the new file is drawn before any of them, and until the last one
  // has returned the view still holds the previous file's state and
  // `current.current` still names it. So a writer who makes a file and
  // types straight away was typing into the file they had just left, and
  // it was saved there. The caret readout flake in navigation.spec.ts was
  // this: three characters typed, one of them in the new file.
  await expect(tab.locator(".cm-editor")).toBeVisible({ timeout: 30_000 });
  const before = await textOf(app, project, "main.tex");

  // A second and a half of latency, applied once the project is open. On
  // this machine the three awaits return in a few milliseconds and the
  // window is too narrow to lose a keystroke in, which is exactly why the
  // fault reached a writer and not a test: it belongs to a slow link, a
  // loaded machine or a large document. So the window is made wide enough
  // to type into rather than waited for. At 500 ms the click alone spends
  // most of it and the test passed either way, which is worth knowing
  // before anybody lowers this number.
  const cdp = await tab.context().newCDPSession(tab);
  await cdp.send("Network.enable");
  await cdp.send("Network.emulateNetworkConditions", {
    offline: false, latency: 1500, downloadThroughput: -1, uploadThroughput: -1,
  });

  await tab.getByTestId("new-file").click();
  await tab.keyboard.type("swapped");
  await tab.keyboard.press("Enter");
  // The tab, and nothing else. That is the whole of what a writer has to
  // go on: the file appears in the strip and they start typing. The view
  // is still holding the previous file at that moment, and the three
  // awaits have not returned, which is the window the gate is for.
  await expect(tab.locator('[data-tab][data-path="swapped.tex"]')).toBeVisible({
    timeout: 20_000,
  });
  await tab.locator(".cm-content").click();
  await tab.keyboard.type("Wxyz");

  await cdp.send("Network.emulateNetworkConditions", {
    offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1,
  });

  // The old file is what matters. A character that never arrived is a
  // nuisance the writer sees at once; a character written into a file
  // they are not looking at is a corruption they find much later. Read
  // from disk through the route rather than off the DOM, because the
  // editor is the thing under test. Before the gate this held
  // `...microtype}Wxyz` while the new file was empty.
  await expect
    .poll(async () => textOf(app, project, "main.tex"), { timeout: 15_000 })
    .toBe(before);

  // And the pane comes back. Those keystrokes were dropped, which is the
  // trade the gate makes, so the writer types again and that lands.
  await expect(tab.getByTestId("editor-host")).toHaveAttribute(
    "data-shown", "swapped.tex", { timeout: 20_000 },
  );
  await tab.locator(".cm-content").click();
  await tab.keyboard.type("Wxyz");
  await landed(app, project, "Wxyz", "swapped.tex");
  expect(await textOf(app, project, "main.tex")).toBe(before);
});
