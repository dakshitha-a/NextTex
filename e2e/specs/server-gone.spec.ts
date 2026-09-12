/** What a tab does when the server it is talking to stops.
 *
 *  A pane is a dynamic import, and when a deploy replaces the built assets
 *  under an open tab the only cure is to reload onto the new build. The
 *  boundary does that, once, and it decided when by matching the error
 *  message against a pattern that included a bare `Failed to fetch`, which
 *  is what a browser says for any request it could not make. So a stopped
 *  NextTex was read as a moved deployment: the tab reloaded itself onto
 *  the browser's own error page, and the editor and everything in it that
 *  had not reached the server went with it.
 *
 *  The Windows laptop watched exactly that, four minutes after the app had
 *  promised in a tooltip that what you type is kept here until it
 *  reconnects.
 */
import { test, expect } from "../fixtures";
import { startServer, seedProject } from "../server";
import { openProject } from "../fixtures";

test("a tab whose server stops stays on the page and says so", async ({ page }) => {
  const app = await startServer();
  const project = await seedProject(app, `gone-${Date.now()}`);
  await page.goto(`${app.base}/?token=${app.token}`);
  await page.getByText("Projects", { exact: false }).first().waitFor();
  await openProject(page, project.root);
  await page.locator(".cm-editor").waitFor({ timeout: 30_000 });

  await app.stop();
  // Long enough for the socket to give up, for anything the tab tries next
  // to fail, and for a reload to have happened if one were coming.
  await page.waitForTimeout(20_000);

  expect(page.url(), "the tab navigated away from the app").toContain("127.0.0.1");
  expect(await page.title()).not.toContain("can't be reached");

  // Either the app is still standing, or the boundary is showing, and if it
  // is showing it must not blame an update that did not happen.
  const boundary = page.locator('[data-testid="interface-failed"]');
  if (await boundary.count()) {
    const words = await boundary.innerText();
    expect(words).toContain("not answering");
    expect(words).not.toContain("NextTex updated while this tab was open");
  }
});
