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
