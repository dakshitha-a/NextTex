import { test, expect } from "../fixtures";

/** The three widths the layout actually changes at.
 *
 *  A dissertation is written on whatever screen is to hand -- a laptop on a
 *  train, half a monitor beside a PDF of the handbook -- and every one of
 *  these transitions moves a pane the writer was using.  The rules are in
 *  one comment in App.tsx and were, until now, in no test: below 1400 the
 *  chat stops being a docked column, below 1100 the file rail folds away,
 *  and below 900 the source and the preview take turns instead of splitting
 *  a space too small for either.
 */

const composer = (page: any) => page.locator("textarea");
const railFolded = (page: any) =>
  page.getByRole("button", { name: "Show files" });

/** The chat is slid off the edge rather than unmounted, so that reopening
 *  it is a transition and not a remount of the whole transcript.  What says
 *  it is away is `aria-hidden`, which is also what stops a screen reader
 *  from reading a panel nobody can see. */
const chatAway = (page: any) =>
  expect(page.getByTestId("chat-panel")).toHaveAttribute("aria-hidden", "true");
const chatThere = (page: any) =>
  expect(page.getByTestId("chat-panel")).not.toHaveAttribute(
    "aria-hidden",
    "true",
  );

/** Open the agent panel, and mean it.
 *
 *  `Control+Alt+A` goes to whatever has focus, and a press that lands
 *  while the app is still mounting its keymap, or just after a viewport
 *  resize, reaches nothing. It failed about one run in twenty, which is
 *  often enough to be noise in every full run and rare enough that nobody
 *  chased it. Pressing again is the honest fix: the shortcut is a toggle,
 *  so this checks the panel before each press rather than counting them.
 */
async function openTheAgentPanel(page: any) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const hidden = await page
      .getByTestId("chat-panel")
      .getAttribute("aria-hidden")
      .catch(() => "true");
    if (hidden !== "true") return;
    await page.keyboard.press("Control+Alt+KeyA");
    await page.waitForTimeout(400);
  }
  await chatThere(page);
}

test("a wide window shows everything at once", async ({ tab }) => {
  await tab.setViewportSize({ width: 1600, height: 1000 });
  await expect(composer(tab)).toBeVisible();
  await chatThere(tab);
  await expect(railFolded(tab)).toHaveCount(0);
  await expect(tab.getByTestId("view-toggle")).toHaveCount(0);
  await expect(tab.locator(".cm-editor")).toBeVisible();
});

test("below 1400 the chat stops taking a column of its own", async ({ tab }) => {
  await tab.setViewportSize({ width: 1200, height: 1000 });
  await chatAway(tab);
  // The files are still there: this width only costs the chat.
  await expect(railFolded(tab)).toHaveCount(0);
});

test("below 1100 the file rail folds to a strip that says where it went", async ({
  tab,
}) => {
  await tab.setViewportSize({ width: 1000, height: 1000 });
  await expect(railFolded(tab)).toBeVisible();
  await expect(tab.locator(".cm-editor")).toBeVisible();
});

/** How much of the interface is off the right hand edge, in pixels. */
async function offScreen(tab: import("@playwright/test").Page) {
  return tab
    .locator(".nx-frame")
    .evaluate((el) => el.scrollWidth - el.clientWidth);
}

test("a window narrower than the layout scrolls instead of cutting off", async ({
  tab,
}) => {
  // Below the stated minimum the panes stop being arranged and start being
  // crushed, so the layout says so and the frame outside it scrolls.  What
  // this replaced was silent: the right hand edge was simply unreachable,
  // with nothing to indicate anything was missing.
  // Measured rather than guessed: the tight arrangement is one middle pane
  // and a folded rail, and `min-content` follows that, so 700 and even 460
  // still fit and correctly do not scroll.  This is a width where the panes
  // really cannot be honoured.
  await tab.setViewportSize({ width: 380, height: 900 });
  await expect.poll(() => offScreen(tab)).toBeGreaterThan(0);

  // Everything is reachable: the frame can be scrolled to the far edge of the
  // interface rather than merely reporting that something is out there.
  const reached = await tab.locator(".nx-frame").evaluate((el) => {
    el.scrollLeft = el.scrollWidth;
    return el.scrollLeft;
  });
  expect(reached).toBeGreaterThan(0);

  // And the shell still cannot be scrolled, which is the property that stops
  // a focused composer dragging the whole layout sideways.  It overflows, and
  // `overflow: clip` means there is no scroll port to move: asking it to
  // scroll does nothing.  The port is the frame outside it, deliberately.
  const shellMoved = await tab.locator(".nx-shell").evaluate((el) => {
    el.scrollLeft = 200;
    return el.scrollLeft;
  });
  expect(shellMoved).toBe(0);
});

test("a window the layout does fit does not scroll at all", async ({ tab }) => {
  // The guard on the test above: a scroll port that appears at every width
  // would be a regression rather than a fix, and this is the width the
  // narrowest existing arrangement is written for.
  await tab.setViewportSize({ width: 860, height: 1000 });
  await expect(tab.getByTestId("view-toggle")).toBeVisible();
  await expect.poll(() => offScreen(tab)).toBe(0);
});

test("below 900 the source and the preview take turns", async ({ tab }) => {
  await tab.setViewportSize({ width: 860, height: 1000 });
  const toggle = tab.getByTestId("view-toggle");
  await expect(toggle).toBeVisible();
  await expect(tab.locator(".cm-editor")).toBeVisible();

  await toggle.getByRole("button", { name: "Preview" }).click();
  // Hidden rather than unmounted: switching back must not cost a reparse
  // of the document or the writer's scroll position.
  await expect(tab.locator(".cm-editor")).toBeHidden();
  await tab
    .getByTestId("view-toggle")
    .getByRole("button", { name: "Source" })
    .first()
    .click();
  await expect(tab.locator(".cm-editor")).toBeVisible();
});

test("widening gives back the layout the writer chose, not the default", async ({
  tab,
}) => {
  // Fold the chat away deliberately, then shrink and grow.  Coming back
  // with the panel reopened would undo a decision the writer made.
  await tab.setViewportSize({ width: 1600, height: 1000 });
  await expect(composer(tab)).toBeVisible();
  await tab.getByRole("button", { name: "Fold this panel away" }).click();
  await expect(tab.getByRole("button", { name: "Show claude" })).toBeVisible();

  await tab.setViewportSize({ width: 1200, height: 1000 });
  await tab.setViewportSize({ width: 1600, height: 1000 });
  await expect(tab.getByRole("button", { name: "Show claude" })).toBeVisible();
});

test("double-clicking the preview header gives the page the window", async ({
  tab,
}) => {
  await tab.setViewportSize({ width: 1600, height: 1000 });
  await expect(tab.locator('[role="tree"]')).toBeVisible();

  await tab.getByTestId("preview-header").dblclick();

  // Everything else folds to a strip, and the page is what is left.
  await expect(tab.getByTestId("collapsed-files")).toBeVisible();
  await expect(tab.getByTestId("collapsed-source")).toBeVisible();
  await expect(tab.locator('[role="tree"]')).toBeHidden();
  await expect(tab.locator(".cm-editor")).toBeHidden();
  await expect(tab.getByTestId("preview-header")).toBeVisible();

  // And a second double click gives back exactly what was there before.
  await tab.getByTestId("preview-header").dblclick();
  await expect(tab.locator('[role="tree"]')).toBeVisible();
  await expect(tab.locator(".cm-editor")).toBeVisible();
  await expect(tab.getByTestId("chat")).toBeVisible();
  await expect(tab.getByTestId("collapsed-files")).toHaveCount(0);
});

test("double-clicking the empty tab strip gives the source the window", async ({
  tab,
}) => {
  await tab.setViewportSize({ width: 1600, height: 1000 });
  await tab.getByTestId("tabs-blank").dblclick();

  await expect(tab.getByTestId("collapsed-preview")).toBeVisible();
  await expect(tab.locator(".cm-editor")).toBeVisible();
  // The file list stays: writing means moving between chapters, and a
  // mode that hides the way to the next one is a mode you leave at once.
  await expect(tab.locator('[role="tree"]')).toBeVisible();
  await expect(tab.getByTestId("collapsed-files")).toHaveCount(0);
  await expect(tab.getByTestId("chat")).toBeHidden();

  await tab.getByTestId("tabs-blank").dblclick();
  await expect(tab.getByTestId("chat")).toBeVisible();
  await expect(tab.getByTestId("collapsed-preview")).toHaveCount(0);
});

test("a mode gives back the layout it was entered from, not a tidy one", async ({
  tab,
}) => {
  await tab.setViewportSize({ width: 1600, height: 1000 });
  // Put the agent away first: coming back from reading should not undo a
  // decision the writer made before they started reading.
  await tab.getByTestId("chat-header").click();
  await expect(tab.getByTestId("chat")).toBeHidden();

  await tab.getByTestId("preview-header").dblclick();
  await expect(tab.locator(".cm-editor")).toBeHidden();

  await tab.getByTestId("preview-header").dblclick();
  await expect(tab.locator(".cm-editor")).toBeVisible();
  await expect(tab.getByTestId("chat")).toBeHidden();
});

test("one click on a pane header folds it away", async ({ tab }) => {
  await tab.setViewportSize({ width: 1600, height: 1000 });

  await tab.getByTestId("chat-header").click();
  await expect(tab.getByTestId("chat")).toBeHidden();

  await tab.getByTestId("tabs-blank").click();
  await expect(tab.locator(".cm-editor")).toBeHidden({ timeout: 5_000 });
  await tab.getByTestId("collapsed-source").click();
  await expect(tab.locator(".cm-editor")).toBeVisible();

  await tab.getByTestId("preview-header").click();
  await expect(tab.getByTestId("collapsed-preview")).toBeVisible({
    timeout: 5_000,
  });
});

test("clicking a tab is not clicking the strip it sits in", async ({
  app, project, tab,
}) => {
  // The empty run of the strip folds the pane; a tab must still just be a
  // tab, however close to the blank space it sits.
  await tab.evaluate(
    async ({ base, token, id }) => {
      await fetch(`${base}/api/projects/${id}/file`, {
        method: "PUT",
        headers: { "content-type": "application/json", "x-nexttex-token": token },
        body: JSON.stringify({
          path: "second.tex", text: "x\n", compile: false, create: true,
        }),
      });
    },
    { base: app.base, token: app.token, id: project.id },
  );
  await tab.locator('[role="tree"] [data-path="second.tex"]').click();
  await expect(tab.locator('[data-tab][data-path="second.tex"]')).toBeVisible({
    timeout: 15_000,
  });

  await tab.locator('[data-tab][data-path="main.tex"] button').first().click();
  await tab.waitForTimeout(500);
  await expect(tab.locator(".cm-editor")).toBeVisible();
});

test("the error list closes from its own bar", async ({ tab }) => {
  const editor = tab.locator(".cm-content");
  await editor.click();
  await tab.keyboard.press("End");
  await tab.keyboard.type("\n\\badcommand{x}\n");
  await expect(tab.getByTestId("status")).toHaveAttribute("data-state", /error|warn/, {
    timeout: 30_000,
  });
  await tab.getByTestId("status").click();
  await expect(tab.getByTestId("diagnostics-header")).toBeVisible();

  await tab.getByTestId("diagnostics-header").click();
  await expect(tab.getByTestId("diagnostics-header")).toHaveCount(0);
});


test("writing keeps the file list even where the window had hidden it", async ({
  tab,
}) => {
  // Below 1100 the rail folds itself away.  Writing mode is an explicit
  // request for it, so it comes back -- and going back out returns the
  // window to what it was doing on its own.
  await tab.setViewportSize({ width: 1000, height: 900 });
  await expect(tab.getByTestId("collapsed-files")).toBeVisible();

  await tab.getByTestId("tabs-blank").dblclick();
  await expect(tab.locator('[role="tree"]')).toBeVisible();
  await expect(tab.getByTestId("collapsed-preview")).toBeVisible();

  await tab.getByTestId("tabs-blank").dblclick();
  await expect(tab.getByTestId("collapsed-files")).toBeVisible();
});

test("the agent panel opens and closes from the keyboard, docked", async ({
  tab,
}) => {
  await tab.setViewportSize({ width: 1600, height: 1000 });
  await chatThere(tab);
  // Not Super-A as first asked for: on Linux the window manager takes Super
  // before the browser sees it, Cmd/Ctrl-A alone is Select All, and
  // Cmd/Ctrl-Shift-A is Chrome's own tab search.  Alt keeps the A.
  await tab.keyboard.press("Control+Alt+KeyA");
  await expect(tab.getByTestId("agent-button-claude")).toBeVisible();
  await tab.keyboard.press("Control+Alt+KeyA");
  await expect(composer(tab)).toBeVisible();
});

test("the same shortcut works on the overlay, and leaves the caret in the box", async ({
  tab,
}) => {
  await tab.setViewportSize({ width: 1200, height: 1000 });
  await chatAway(tab);
  await tab.keyboard.press("Control+Alt+KeyA");
  await chatThere(tab);
  // A shortcut that opens a panel you then have to click into has saved
  // nobody anything.
  await expect(composer(tab)).toBeFocused();
  await tab.keyboard.press("Control+Alt+KeyA");
  await chatAway(tab);
});

test("reaching for the preview puts the overlay away", async ({ tab }) => {
  await tab.setViewportSize({ width: 1200, height: 1000 });
  await tab.getByTestId("agent-button-claude").click();
  await chatThere(tab);
  // The panel lies over the preview at this width, so the click that means
  // "let me read this" is the one that should give the width back.
  await tab.getByTestId("preview-pane").click({ position: { x: 20, y: 200 } });
  await chatAway(tab);
});

test("the docked panel is not closed by a click on the preview", async ({
  tab,
}) => {
  // Nothing is covered at this width, so nothing needs to get out of the
  // way -- and a panel that vanished on every click into the page would be
  // unusable.
  await tab.setViewportSize({ width: 1600, height: 1000 });
  await chatThere(tab);
  await tab.getByTestId("preview-pane").click({ position: { x: 20, y: 200 } });
  await chatThere(tab);
});

test("reading mode still gives the overlay back", async ({ tab }) => {
  await tab.setViewportSize({ width: 1200, height: 1000 });
  await tab.getByTestId("agent-button-claude").click();
  await chatThere(tab);
  // The header is a control, not "the page": closing the overlay from it
  // would be saved as the layout reading mode was entered from, and
  // leaving reading mode would then give back a window with no agent in
  // it.
  // The same spot twice, which is the gesture a writer actually makes.
  // Near the left edge, because at this width the overlay covers the
  // middle of the header before the mode starts -- and because the left of
  // this bar has to stay the label rather than becoming the project
  // switcher, or the second click leaves the document.
  const header = tab.getByTestId("preview-header");
  await header.dblclick({ position: { x: 20, y: 16 } });
  await expect(tab.getByTestId("collapsed-files")).toBeVisible();
  await header.dblclick({ position: { x: 20, y: 16 } });
  await chatThere(tab);
  await expect(tab.locator(".cm-editor")).toBeVisible();
});

/** Escape closes the agent panel, from inside the agent panel.
 *
 *  The shortcut that opens it leaves the caret in the composer, which is
 *  what makes the two a pair.  It is deliberately not a global binding:
 *  Escape is also how a keyboard leaves CodeMirror, where Tab indents.
 */
test("escape closes the agent panel from its composer", async ({ tab }) => {
  await tab.setViewportSize({ width: 1600, height: 1000 });
  await chatThere(tab);
  await composer(tab).last().focus();
  await tab.keyboard.press("Escape");
  await expect(tab.getByTestId("agent-button-claude")).toBeVisible();
});

test("the shortcut opens it and escape closes it, on the overlay", async ({
  tab,
}) => {
  await tab.setViewportSize({ width: 1200, height: 1000 });
  await chatAway(tab);
  await tab.keyboard.press("Control+Alt+KeyA");
  await chatThere(tab);
  await expect(composer(tab)).toBeFocused();
  await tab.keyboard.press("Escape");
  await chatAway(tab);
});

test("escape closes the panel and never opens it", async ({ tab }) => {
  await tab.setViewportSize({ width: 1200, height: 1000 });
  await chatAway(tab);
  // A key that summoned a panel out of nothing would be a surprise, and
  // there is a shortcut for opening.
  await tab.keyboard.press("Escape");
  await chatAway(tab);
});

test("escape in the editor is the editor's, not the panel's", async ({ tab }) => {
  // Escape is how a keyboard gets out of CodeMirror, where Tab indents
  // rather than moving on.  A global binding took that away and shut the
  // panel instead, which is the regression this stands guard over.
  await tab.setViewportSize({ width: 1600, height: 1000 });
  await chatThere(tab);
  await tab.locator(".cm-content").click();
  await tab.keyboard.press("Escape");
  await chatThere(tab);
});

test("escape leaves the panel alone while a box elsewhere has the caret", async ({
  tab,
}) => {
  await tab.setViewportSize({ width: 1600, height: 1000 });
  await chatThere(tab);
  await tab.getByTestId("file-search-open").click();
  await tab.getByTestId("file-search").fill("main");
  await tab.keyboard.press("Escape");
  await chatThere(tab);
});

test("escape closes the popover in front of the panel, not the panel", async ({
  tab,
}) => {
  await tab.setViewportSize({ width: 1600, height: 1000 });
  await chatThere(tab);
  // Escape belongs to the innermost thing that can be dismissed.
  await tab.getByTestId("appearance").first().click();
  await expect(tab.getByRole("dialog", { name: "Settings" })).toBeVisible();
  await tab.keyboard.press("Escape");
  await expect(tab.getByRole("dialog", { name: "Settings" })).toBeHidden();
  await chatThere(tab);
});

/** The agent is reachable with a mouse in every layout.
 *
 *  It used to be two controls that were never both present, and the one
 *  below 1400px lived inside the editor pane -- which is hidden when the
 *  source is folded and when the preview has the window below 900px. In
 *  both of those the only route to the agent was the keyboard.
 */
test("the agent can be reached with the source folded away", async ({ tab }) => {
  await tab.setViewportSize({ width: 1200, height: 1000 });
  await chatAway(tab);
  // Fold the source: the old button went with it.
  await tab.getByTestId("tabs-blank").click();
  await expect(tab.getByTestId("collapsed-source")).toBeVisible();
  await tab.getByTestId("agent-button-claude").click();
  await chatThere(tab);
});

test("the agent can be reached below 900 with the preview showing", async ({
  tab,
}) => {
  await tab.setViewportSize({ width: 800, height: 900 });
  await chatAway(tab);
  await tab.getByRole("button", { name: "Preview" }).first().click();
  await tab.getByTestId("agent-button-claude").click();
  await chatThere(tab);
});

test("a parked overlay cannot be reached, and cannot drag the layout", async ({
  tab,
}) => {
  // The overlay is slid off the edge with a transform, which leaves it laid
  // out and hit-testable.  Clicking anything inside it made the browser
  // scroll it into view and take the whole shell with it: the rail ended up
  // at x=-271 and the editor's text was clipped at x=0.  Found by a design
  // review of the rendered screens, not by any assertion here.
  await tab.setViewportSize({ width: 1300, height: 900 });
  await chatAway(tab);

  const geometry = () =>
    tab.evaluate(() => {
      const shell = document.querySelector(".bg-surround") as HTMLElement;
      const rail = document
        .querySelector('[role="tree"]')
        ?.closest(".nx-pane") as HTMLElement | null;
      return {
        scroll: shell?.scrollLeft ?? -1,
        railX: rail ? Math.round(rail.getBoundingClientRect().x) : null,
      };
    });

  expect(await geometry()).toEqual({ scroll: 0, railX: 0 });
  // Nothing inside a panel nobody can see is focusable or clickable.
  await expect(tab.getByTestId("model-open")).toBeHidden();
  await expect(tab.getByTestId("chat-panel")).toHaveAttribute("inert", "");
  expect(await geometry()).toEqual({ scroll: 0, railX: 0 });

  // And it all comes back when the panel is actually opened.
  await tab.keyboard.press("Control+Alt+KeyA");
  await chatThere(tab);
  expect((await geometry()).railX).toBe(0);
});

/** Where the layout actually sits, in viewport pixels: what a screenshot of
 *  the window would show rather than what the classes say it should. */
const placement = (page: any) =>
  page.evaluate(() => {
    // The shell is the outermost of these, so it is first in document
    // order; the PDF pane carries the same ground colour further down.
    const shell = document.querySelector(".bg-surround") as HTMLElement;
    const rail = document
      .querySelector('[role="tree"]')
      ?.closest(".nx-pane") as HTMLElement | null;
    const panel = document.querySelector(
      "[data-testid=chat-panel]",
    ) as HTMLElement;
    const pill = document.querySelector(
      "[data-testid^=agent-button-]",
    ) as HTMLElement;
    const box = panel.getBoundingClientRect();
    return {
      scroll: Math.round(shell.scrollLeft),
      railX: rail ? Math.round(rail.getBoundingClientRect().x) : null,
      // How much of the shell's own ground is showing to the right of the
      // panel.  The black band in the report was this, and it was as wide
      // as the panel itself.
      gap: Math.round(shell.getBoundingClientRect().right - box.right),
      // The pill is `position: fixed`, so it cannot move.  If it ends up
      // over the panel, the panel moved out from under it.
      pillInsidePanel: pill.getBoundingClientRect().right > box.left + 1,
    };
  });

for (const scale of [100, 110]) {
  test(`opening the overlay never drags the layout, at ${scale}%`, async ({
    tab,
  }) => {
    // The parked panel is held outside the shell by a transform, so while
    // it is sliding in the composer is still beyond the right edge -- and
    // `toggleChat` puts the caret in that composer 60ms after opening it.
    // A bare `focus()` has the browser scroll the composer into view, and
    // the shell is `overflow: hidden`, which hides the scrollbar but is
    // still a scroll container.  What that leaves is the rail off the
    // screen, the editor's gutter clipped at x=0, and a band of bare
    // ground down the right the width of the panel.  Reported from a
    // screenshot; intermittent in life because it turns on how far the
    // slide had got by the time the focus landed, and on whether anything
    // later relaid the shell out and clamped the offset away.
    //
    // Holding the panel where it is parked takes the timing out of it.  It
    // is the same position the slide passes through, and the caret lands
    // in it either way, so a focus that can scroll the shell will scroll
    // it every time rather than on the runs where the machine was slow.
    if (scale !== 100) {
      await tab.evaluate((value: number) => {
        localStorage.setItem("nexttex.ui.scale", String(value));
      }, scale);
      await tab.reload();
      await tab.locator(".cm-editor").waitFor({ timeout: 20_000 });
    }
    // 1300px is an overlay at either size, and still wide enough at both to
    // keep the file rail on screen, which is what shows the drag.
    await tab.setViewportSize({ width: 1300, height: 900 });
    await chatAway(tab);
    const held = await tab.addStyleTag({
      content:
        '[data-testid="chat-panel"] { transform: translateX(100%) !important;' +
        " transition: none !important; }",
    });

    await tab.keyboard.press("Control+Alt+KeyA");
    await chatThere(tab);
    // Past the 60ms the focus waits for, with frames to spare.
    await tab.waitForTimeout(300);
    const opening = await placement(tab);
    expect(
      opening.scroll,
      "the caret landing in the composer scrolled the shell sideways",
    ).toBe(0);
    expect(opening.railX, "the file rail was dragged off the left").toBe(0);

    // And with the panel let go, it covers the right edge, with the pill
    // that opened it still outside it.
    await held.evaluate((tag: HTMLElement) => tag.remove());
    await tab.waitForTimeout(400);
    const settled = await placement(tab);
    expect(settled.scroll, "the shell is scrolled sideways").toBe(0);
    expect(settled.railX, "the file rail was dragged off the left").toBe(0);
    expect(
      Math.abs(settled.gap),
      "a band of bare ground beside the panel",
    ).toBeLessThanOrEqual(1);
    expect(
      settled.pillInsidePanel,
      "the agent pill is sitting inside the panel",
    ).toBe(false);
  });
}

test("the agent button never sits on top of the panel it opens", async ({
  tab,
}) => {
  // Only the docked case moved it aside, so on a narrow window the pill
  // landed inside the overlay -- over the model popover, two pixels above
  // Send, and across the corner of the box you type into.
  await tab.setViewportSize({ width: 1300, height: 900 });
  await openTheAgentPanel(tab);
  const pill = (await tab.getByTestId("agent-button-claude").boundingBox())!;
  const panel = (await tab.getByTestId("chat-panel").boundingBox())!;
  expect(
    pill.x + pill.width,
    "the pill overlaps the agent panel",
  ).toBeLessThanOrEqual(panel.x + 1);
});

test("the rail's handle resizes the rail rather than selecting the editor", async ({
  tab,
}) => {
  // R-111. Two sweep shots that should have differed did not: the rail was
  // at the same 240 pixels before and after a drag, and the only change
  // between the two images was a text selection inside the editor, in both
  // themes. So the press never reached the handle. The visible divider is
  // one pixel and the thing that answers a press is a nine-pixel span that
  // overhangs it, half into the pane on each side, and the half over the
  // editor is the half that has to win.
  const rail = tab.locator('[data-testid="chat"]').first();
  const handle = tab.locator(".nx-handle").first();
  await expect(handle).toBeVisible();

  const before = await tab.evaluate(() =>
    Math.round(
      document.querySelector('[role="tree"]')?.closest(".nx-pane")
        ?.getBoundingClientRect().width ?? 0,
    ),
  );
  expect(before).toBeGreaterThan(0);

  const box = (await handle.boundingBox())!;
  const middle = box.y + box.height / 2;
  // From the half of the hit zone that hangs over the editor, which is the
  // side the record says loses.
  await tab.mouse.move(box.x + box.width / 2 + 3, middle);
  await tab.mouse.down();
  // A move per frame, because the handler is throttled with
  // `requestAnimationFrame`: ten steps dispatched in one tick are nine
  // moves the app never sees, and the last one can land after the release.
  for (const step of [25, 50, 75, 100]) {
    await tab.mouse.move(box.x + step, middle);
    await tab.waitForTimeout(40);
  }
  await tab.mouse.up();
  await tab.waitForTimeout(100);

  const after = await tab.evaluate(() =>
    Math.round(
      document.querySelector('[role="tree"]')?.closest(".nx-pane")
        ?.getBoundingClientRect().width ?? 0,
    ),
  );
  expect(after).toBeGreaterThan(before + 40);

  // And nothing was selected on the way past, which is the other half of
  // what those two shots showed.
  const selected = await tab.evaluate(() =>
    (window.getSelection()?.toString() ?? "").trim(),
  );
  expect(selected).toBe("");
  expect(rail).toBeTruthy();
});
