/** What the strip and the preview say through a project's first build.
 *
 *  `compile_start` is news, and the broadcaster keeps no backlog, so a
 *  browser is told only if it was subscribed at that instant. Opening a
 *  project builds it: `connect()` constructs an `EventSource`, which
 *  returns before the connection exists, and the compile request goes out a
 *  few lines later, so the tab regularly missed its own build starting.
 *
 *  For the whole of that build, several seconds and the first thing anybody
 *  sees, the strip said Ready and the preview said "Nothing has been
 *  typeset yet. An empty document produces no pages." Both were false, and
 *  the second is a statement about the writer's own work that sends them
 *  looking for a fault in a document that is fine. The Windows laptop met
 *  it as the first thing a joining writer sees.
 *
 *  The cure is the stream's first frame being the state rather than the
 *  news. The latch that same absence causes is held by
 *  `frontend/src/compile-state.test.ts`, which can stage a dropped stream
 *  where a browser cannot.
 */
import { test, expect } from "../fixtures";

test("a project's first build is never drawn as a finished empty one", async ({
  app, page, project,
}) => {
  await page.goto(`${app.base}/?token=${app.token}`);
  await page.getByText("Projects", { exact: false }).first().waitFor();

  const strip = page.locator('[data-testid="status"]');
  const pane = page.locator('[data-testid="preview-pane"]');
  const seen: string[] = [];
  let claimedEmpty = false;

  await page.getByText(project.root.split("/").pop()!, { exact: false }).first().click();

  // Sample both from the moment the project opens until the build lands.
  for (let tick = 0; tick < 90; tick += 1) {
    const state = await strip
      .getAttribute("data-state", { timeout: 1000 })
      .catch(() => null);
    if (state && seen[seen.length - 1] !== state) seen.push(state);
    const words = await pane.innerText({ timeout: 1000 }).catch(() => "");
    if (words.includes("An empty document produces no pages")) claimedEmpty = true;
    if (state === "built") break;
    await page.waitForTimeout(250);
  }

  expect(claimedEmpty, "the preview called the document empty while it was building")
    .toBe(false);
  expect(seen, `the strip never said it was building: ${seen.join(" then ")}`)
    .toContain("compiling");
  expect(seen[seen.length - 1]).toBe("built");
});
