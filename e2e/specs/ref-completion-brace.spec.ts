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
  await tab.keyboard.press("Control+End");
  await tab.keyboard.press("ArrowUp");
  await tab.keyboard.press("Home");
  await tab.keyboard.type("See Section~\\ref{sec:");
  await tab.locator(".cm-tooltip-autocomplete").waitFor({ timeout: 5000 });
  await tab.keyboard.press("Enter");
  await tab.keyboard.type(" shows it.");
  await expect(tab.locator(".cm-activeLine")).toHaveText(
    /See Section~\\ref\{sec:[a-z:_-]+\} shows it\./,
  );
});
