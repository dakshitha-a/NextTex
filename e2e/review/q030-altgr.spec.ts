import { test, expect } from "../fixtures";

/** Q-030: a character typed with AltGr, taken as one of the app's chords.
 *
 *  On Windows, Chrome, Edge and Firefox report AltGr as Ctrl and Alt held
 *  together, with the character itself in `key` and the physical key in
 *  `code`.  So the Polish ą, ę and ó arrive as Ctrl, Alt and KeyA, KeyE or
 *  KeyO, the euro sign on a German or French layout as Ctrl, Alt and KeyE.
 *  This dispatches exactly those events at the editor, as a Windows
 *  browser would, and prints whether the app swallowed each one, which is
 *  what it does to a chord it acted on, and what the editor holds after. */

const PRESSES = [
  { name: "Polish ą (AltGr+A)", key: "ą", code: "KeyA" },
  { name: "Polish ę, or the euro sign (AltGr+E)", key: "ę", code: "KeyE" },
  { name: "Polish ó (AltGr+O)", key: "ó", code: "KeyO" },
  { name: "Polish ś (AltGr+S), no chord", key: "ś", code: "KeyS" },
];

test("AltGr characters on a Windows layout", async ({ tab }) => {
  await expect(tab.locator(".cm-editor")).toBeVisible({ timeout: 30_000 });
  await tab.locator(".cm-content").click();
  await tab.keyboard.press("Control+End");
  for (const press of PRESSES) {
    const swallowed = await tab.evaluate(({ key, code }) => {
      const target = document.activeElement ?? document.body;
      const event = new KeyboardEvent("keydown", {
        key, code, ctrlKey: true, altKey: true, bubbles: true, cancelable: true,
      });
      return !target.dispatchEvent(event);
    }, press);
    console.log(`${press.name}: ${swallowed ? "TAKEN AS A CHORD" : "left alone"}`);
    await tab.waitForTimeout(400);
    if (swallowed) {
      // Put the layout back before the next press.
      await tab.keyboard.press("Escape");
      await tab.locator(".cm-content").click().catch(() => undefined);
    }
  }
  const agentOpen = await tab.getByTestId("composer").count().catch(() => 0);
  console.log("the Claude column's composer on screen afterwards:", agentOpen > 0);
});
