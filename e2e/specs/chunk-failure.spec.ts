import { test, expect } from "@playwright/test";
import { startServer, seedProject, type Instance } from "../server";

/** What happens when part of the interface is not there.
 *
 *  The interface is split into chunks fetched when first needed, and their
 *  names carry a content hash, so an update replaces all of them. A tab
 *  that was already open is then holding an `index.html` naming files the
 *  server no longer has -- and NextTex updates itself while people are
 *  looking at it, so this is an ordinary Tuesday rather than an edge case.
 *
 *  There was no error boundary anywhere in the application. React unwound
 *  past every component and unmounted the tree, leaving a black window with
 *  no message and no way back, for a fault a reload would have fixed.
 */

let app: Instance;
let project: { id: string; root: string };

test.beforeAll(async () => {
  app = await startServer();
  project = await seedProject(app, `chunk-${Date.now()}`);
});

test.afterAll(async () => {
  await app?.stop();
});

test("a missing chunk does not leave a black window", async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const page = await context.newPage();

  // Fail it every time, so the one automatic reload is used up and the
  // message is what is left. In the real case the reload is the fix.
  await page.route("**/assets/Pdf-*.js", (route) => route.abort());

  await page.goto(`${app.base}/?token=${app.token}`);
  await page.getByText(project.root.split("/").pop()!, { exact: false })
    .first().click();

  // Something legible, rather than nothing at all.
  await expect(page.getByTestId("interface-failed")).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.getByTestId("interface-failed"))
    .toContainText("could not be loaded");
  // It says the writing is safe, because the first thought on seeing this
  // is that something has been lost.
  await expect(page.getByTestId("interface-failed"))
    .toContainText("your work is on disk");
  await expect(page.getByRole("button", { name: "Reload" })).toBeVisible();

  // And only the pane is lost. The preview has a boundary of its own, so a
  // chunk that will not load costs the pane rather than the window, and the
  // writing carries on in the half of the screen that still works.
  await expect(page.locator(".cm-editor")).toBeVisible();
});

test("it reloads itself once before giving up", async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const page = await context.newPage();

  let loads = 0;
  page.on("load", () => (loads += 1));

  // Gone for the whole of the first page's life, there on the next: what
  // an update looks like from a tab that was already open. Keyed on the
  // load count rather than on a request count, because the build also
  // emits a modulepreload for the same file -- failing only the first
  // request kills the preload, which nothing is waiting on, and the import
  // that follows then succeeds and there is no fault to recover from.
  await page.route("**/assets/Pdf-*.js", (route) =>
    loads <= 1 ? route.abort() : route.continue(),
  );

  await page.goto(`${app.base}/?token=${app.token}`);
  await page.getByText(project.root.split("/").pop()!, { exact: false })
    .first().click();

  // Waited for explicitly. The editor is up on the first load already --
  // the fault is confined to the preview -- so asserting on the editor
  // would pass before the reload had even been decided on.
  await expect.poll(() => loads, { timeout: 30_000 }).toBeGreaterThan(1);

  // The writer sees the app, not an apology: after an update one reload is
  // the entire fix, and asking them to do it by hand is asking them to
  // guess.
  await expect(page.locator("canvas").first()).toBeVisible({ timeout: 45_000 });
  await expect(page.getByTestId("interface-failed")).toHaveCount(0);
});
