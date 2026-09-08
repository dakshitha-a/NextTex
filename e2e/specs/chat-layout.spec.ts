import { test, expect } from "@playwright/test";
import { startServer, seedProject, type Instance } from "../server";

/** Where the agent panel is, through every way it can change.
 *
 *  It has two arrangements -- a docked column when the window is wide
 *  enough, an overlay when it is not -- and the width at which it swaps is
 *  1400px of layout space. The swap is where this goes wrong: the panel's
 *  class comes from which arrangement it is in, and its width and its
 *  neighbours come from the measured width, and for a while those were two
 *  separate pieces of state that could disagree for a render. What that
 *  looks like is a panel pushed off to one side with an empty box of
 *  exactly its own size beside it -- reported, and not reproducible on
 *  purpose, which is the shape of a race.
 *
 *  So this asserts the invariant rather than the mechanism: the layout
 *  never scrolls sideways, and the panel is either flush with the right
 *  edge or not on screen at all.
 */

let app: Instance;
let project: { id: string; root: string };

test.beforeAll(async () => {
  app = await startServer();
  project = await seedProject(app, `layout-${Date.now()}`);
});

test.afterAll(async () => {
  await app?.stop();
});

type Fault = { label: string; scrollW: number; clientW: number; right: number };

async function settled(page: any, label: string, faults: Fault[]) {
  // Past the 180ms slide, so an animation in flight is not read as a fault.
  await page.waitForTimeout(420);
  const info = await page.evaluate(() => {
    const panel = document.querySelector("[data-testid=chat-panel]") as HTMLElement | null;
    if (!panel) return null;
    const box = panel.getBoundingClientRect();
    return {
      scrollW: document.documentElement.scrollWidth,
      clientW: document.documentElement.clientWidth,
      right: Math.round(box.right),
      width: Math.round(box.width),
      hidden: getComputedStyle(panel).visibility === "hidden",
      panels: document.querySelectorAll("[data-testid=chat-panel]").length,
    };
  });
  if (!info) return;
  // Exactly one, ever: two mounts of the same panel is the other way this
  // family of bug happens.
  expect(info.panels).toBe(1);
  if (info.scrollW > info.clientW + 1) {
    faults.push({ label: `${label}: the page scrolls sideways`, ...info });
  }
  if (!info.hidden && info.right > info.clientW + 1) {
    faults.push({ label: `${label}: the panel hangs off the right`, ...info });
  }
  if (!info.hidden && info.width > 0 && info.right < info.clientW - 1) {
    faults.push({ label: `${label}: a gap to the right of the panel`, ...info });
  }
}

test("the panel stays where it belongs through every change", async ({ browser }) => {
  const faults: Fault[] = [];
  const context = await browser.newContext({ viewport: { width: 1600, height: 900 } });
  const page = await context.newPage();
  await page.goto(`${app.base}/?token=${app.token}`);
  await page.getByText(project.root.split("/").pop()!, { exact: false }).first().click();
  await page.locator(".cm-editor").waitFor({ timeout: 45_000 });

  for (let round = 0; round < 3; round += 1) {
    await page.keyboard.press("Control+Alt+a");
    await settled(page, `toggle ${round}`, faults);
  }

  // Across the breakpoint in both directions, and either side of it.
  for (const width of [1380, 1420, 1399, 1401, 1300, 1600]) {
    await page.setViewportSize({ width, height: 900 });
    await settled(page, `at ${width}px`, faults);
    await page.keyboard.press("Control+Alt+a");
    await settled(page, `at ${width}px, toggled`, faults);
  }

  expect(faults).toEqual([]);
  await context.close();
});

test("a narrow window never docks it, not even for a frame", async ({ browser }) => {
  // The panel used to paint as a docked column and be moved a render
  // later, because the flag saying which arrangement it was in was state
  // synced from the width by an effect rather than read from the width.
  //
  // Checking after things settle would pass either way -- the effect
  // corrects it within a frame or two. So every frame is sampled, from
  // before the page has run any of its own script.
  const context = await browser.newContext({ viewport: { width: 1200, height: 900 } });
  const page = await context.newPage();
  await page.addInitScript(() => {
    (window as any).__seen = new Set<string>();
    const look = () => {
      const panel = document.querySelector("[data-testid=chat-panel]");
      if (panel) (window as any).__seen.add(getComputedStyle(panel).position);
      requestAnimationFrame(look);
    };
    requestAnimationFrame(look);
  });
  await page.goto(`${app.base}/?token=${app.token}`);
  await page.getByText(project.root.split("/").pop()!, { exact: false }).first().click();
  await page.locator(".cm-editor").waitFor({ timeout: 45_000 });
  await page.waitForTimeout(800);

  const seen = await page.evaluate(() => [...(window as any).__seen]);
  // Below the breakpoint it is an overlay, and it is only ever that.
  expect(seen).toEqual(["absolute"]);
  await context.close();
});
