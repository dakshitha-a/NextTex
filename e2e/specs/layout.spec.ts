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
