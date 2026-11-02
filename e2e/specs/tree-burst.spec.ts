import { test, expect } from "../fixtures";
import { writeFileSync } from "node:fs";
import { join } from "node:path";

/** A burst of outside writes asks for the file tree once at a time.
 *
 *  On 29 October 2026 a calculation running inside a project folder wrote
 *  scratch files every second, and the browser asked for the tree after
 *  every watcher tick with no limit on how many were in flight: up to ten
 *  at once, each taking up to 21 s while they competed for the server.
 *  The refresh is now one request at a time with one more queued behind
 *  it, so the tree still ends on the last state written.
 */

test("a burst of outside writes keeps one tree request in flight", async ({ tab, project }) => {
  await expect(tab.getByRole("treeitem", { name: /main\.tex/ }).first()).toBeVisible();

  // Each answer held for a while, the way a busy server answered then,
  // so requests asked for during a burst would overlap if nothing held
  // them back.
  let inFlight = 0;
  let most = 0;
  let asked = 0;
  await tab.route(/\/api\/projects\/[^/]+\/tree$/, async (route) => {
    asked += 1;
    inFlight += 1;
    most = Math.max(most, inFlight);
    await new Promise((resolve) => setTimeout(resolve, 1500));
    try {
      await route.continue();
    } finally {
      inFlight -= 1;
    }
  });

  // Further apart than the watcher's debounce, so each is a tick of its own.
  const count = 10;
  for (let n = 1; n <= count; n += 1) {
    writeFileSync(join(project.root, `scratch-${n}.dat`), `${n}\n`);
    await new Promise((resolve) => setTimeout(resolve, 450));
  }

  await expect(tab.getByRole("treeitem", { name: new RegExp(`scratch-${count}\\.dat`) }).first())
    .toBeVisible({ timeout: 20_000 });
  expect(most).toBe(1);
  expect(asked).toBeLessThan(count);
});
