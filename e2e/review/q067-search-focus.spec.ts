import { test, expect } from "../fixtures";

/** Where typing goes after Ctrl+Shift+F.
 *
 *  The probe's writer journey pressed the chord for find across files and
 *  typed a word, and the word went into main.tex rather than into the
 *  search box.  This types a word at several delays after the chord and
 *  prints where each one landed. */
test("typing after the chord for find across files", async ({ tab }) => {
  await expect(tab.locator(".cm-editor")).toBeVisible({ timeout: 30_000 });
  for (const delay of [300, 0, 0, 30]) {
    await tab.locator(".cm-content").click();
    const word = `probe${delay}x`;
    await tab.keyboard.press("Control+Shift+F");
    if (delay) await tab.waitForTimeout(delay);
    await tab.keyboard.type(word);
    await tab.waitForTimeout(400);
    const inDoc = (await tab.locator(".cm-content").innerText()).includes(word);
    const box = tab.getByPlaceholder("Find in project");
    const inBox = (await box.count()) ? (await box.inputValue()).includes(word) : false;
    console.log(`after ${delay} ms: in the document=${inDoc}, in the search box=${inBox}`);
    await tab.keyboard.press("Escape");
    await tab.getByTestId("bar-files").click();
    await tab.waitForTimeout(300);
  }
});
