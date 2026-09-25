import { test, expect } from "../fixtures";

/** A character typed with AltGr is text, not one of the app's chords.
 *
 *  On Windows, browsers report AltGr as Ctrl and Alt held together, with
 *  the character in `key` and the physical key in `code`. The probe
 *  (Q-030) dispatched those events at the editor and the app took the
 *  Polish ą for the chord that shows the Claude column, ę, which is also
 *  the euro sign on German and French layouts, for Writing mode, and ó for
 *  quick open. A Polish writer on Windows could not type three letters. */

async function press(tab, init: KeyboardEventInit): Promise<boolean> {
  return tab.evaluate((init) => {
    const target = document.activeElement ?? document.body;
    return !target.dispatchEvent(new KeyboardEvent("keydown", {
      bubbles: true, cancelable: true, ...init,
    }));
  }, init);
}

test("AltGr letters are left to the text, and Ctrl Alt chords still answer", async ({ tab }) => {
  await expect(tab.locator(".cm-editor")).toBeVisible({ timeout: 30_000 });
  await tab.locator(".cm-content").click();
  for (const [key, code] of [["ą", "KeyA"], ["ę", "KeyE"], ["ó", "KeyO"], ["€", "KeyE"]]) {
    const taken = await press(tab, { key, code, ctrlKey: true, altKey: true });
    expect(taken, `${key} was taken as a chord`).toBe(false);
  }
  // The same physical keys making their own letters are the chords.
  expect(await press(tab, { key: "o", code: "KeyO", ctrlKey: true, altKey: true })).toBe(true);
});
