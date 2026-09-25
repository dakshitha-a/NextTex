import { test, expect } from "../fixtures";

/** What a first press finds, in a session that has not used it yet.
 *
 *  The probe's writer journey pressed the chord for find across files and
 *  typed at once; the Search drawer's code was still being fetched, focus
 *  had not moved, and the word went into main.tex (Q-067). The composer's
 *  menu took 870 ms to appear at its first press, with nothing on screen
 *  meanwhile (Q-062). */

test("a word typed at once after the search chord goes into the box", async ({ tab }) => {
  await expect(tab.locator(".cm-editor")).toBeVisible({ timeout: 30_000 });
  await tab.locator(".cm-content").click();
  const before = await tab.locator(".cm-content").innerText();
  await tab.keyboard.press("Control+Shift+F");
  await tab.keyboard.type("bibliography");
  await expect(tab.getByTestId("project-search")).toHaveValue("bibliography", { timeout: 10_000 });
  expect(await tab.locator(".cm-content").innerText()).toBe(before);
  await expect(tab.getByTestId("search-hit").first()).toBeVisible({ timeout: 10_000 });
});

test("the composer's menu is on screen at its first press", async ({ tab }) => {
  const open = tab.getByTestId("model-open");
  await expect(open).toBeVisible({ timeout: 30_000 });
  const started = Date.now();
  await open.click();
  await expect(tab.getByTestId("model-menu")).toBeVisible({ timeout: 2_000 });
  expect(Date.now() - started).toBeLessThan(500);
});
