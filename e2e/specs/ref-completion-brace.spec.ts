import { test, expect } from "../fixtures";

/** A label accepted inside \ref{ closes the brace.
 *
 *  The probe's writer journey typed \ref{, took a label from the list and
 *  typed on, and everything after went inside the argument: the brace was
 *  never closed, which is a fatal error that cost the preview its pages
 *  (Q-068, Q-066). Accepting now closes an open brace and leaves the caret
 *  after it. */
test("a label accepted inside \\ref{ closes the brace", async ({ tab }) => {
  await expect(tab.locator(".cm-editor")).toBeVisible({ timeout: 30_000 });
  await tab.locator(".cm-content").click();
  // A line of its own, above \end{document}.
  await tab.keyboard.press("Control+End");
  await tab.keyboard.press("ArrowUp");
  await tab.keyboard.press("Home");
  await tab.keyboard.press("Enter");
  await tab.keyboard.press("ArrowUp");
  await tab.keyboard.type("See Section~\\ref{sec:");
  // The list with an option chosen, not only the list: under load the
  // list can draw before its options do, and an Enter then is a newline.
  await expect(tab.locator(".cm-tooltip-autocomplete li[aria-selected=true]")).toBeVisible({ timeout: 5000 });
  // CodeMirror ignores Enter for its `interactionDelay`, 75 ms after the
  // list opens, so a keystroke meant for the text is not taken as a pick;
  // under load the test's Enter fell inside it and became a newline.
  await tab.waitForTimeout(200);
  await tab.keyboard.press("Enter");
  await tab.keyboard.type(" shows it.");
  await expect(tab.locator(".cm-activeLine")).toHaveText(
    /See Section~\\ref\{sec:[a-z:_-]+\} shows it\./,
  );
});
