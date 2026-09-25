import { test, expect } from "../fixtures";

/** What accepting a label from the completion list leaves after \ref{.
 *  The writer journey's \ref{ ended up with no closing brace, which is a
 *  fatal error that costs the preview its PDF (Q-066). */
test("a label accepted inside \\ref{", async ({ tab }) => {
  await expect(tab.locator(".cm-editor")).toBeVisible({ timeout: 30_000 });
  const content = tab.locator(".cm-content");
  await content.click();
  await tab.keyboard.press("Control+End");
  await tab.keyboard.press("ArrowUp");
  await tab.keyboard.press("Home");
  await tab.keyboard.type("\\section{Probe}\\label{sec:probe}\nSee Section~\\ref{");
  const afterBrace = await tab.evaluate(() => {
    const line = document.querySelector(".cm-activeLine")?.textContent ?? "";
    return line;
  });
  console.log(`after typing the brace: "${afterBrace}"`);
  await tab.keyboard.type("sec:");
  await tab.locator(".cm-tooltip-autocomplete").waitFor({ timeout: 5000 });
  await tab.keyboard.press("Enter");
  await tab.waitForTimeout(300);
  const line = await tab.evaluate(() => document.querySelector(".cm-activeLine")?.textContent ?? "");
  console.log(`after accepting the label: "${line}"`);
  await tab.keyboard.type(" shows.");
  const later = await tab.evaluate(() => document.querySelector(".cm-activeLine")?.textContent ?? "");
  console.log(`after typing on: "${later}"`);
});
