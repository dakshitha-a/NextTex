import { test, expect } from "../fixtures";

/** The compiling latch, reached without killing the server.
 *
 *  Killing it makes the tab reload itself into a browser error page, so the
 *  latch cannot be seen that way.  A laptop that sleeps, a tailnet blip or a
 *  proxy timeout drops the event stream while the server lives, which is the
 *  case this stages. */
test("a build that finishes while the tab cannot hear it", async ({ page, app, project, tab }) => {
  const strip = tab.locator('[data-testid="status"]');
  await expect.poll(async () => strip.getAttribute("data-state"),
    { timeout: 90_000 }).toBe("built");
  console.log("BEFORE:", await strip.getAttribute("data-state"), "|", await strip.innerText());

  await tab.locator(".cm-content").click();
  await tab.keyboard.press("Control+End");
  await tab.keyboard.type("x");
  await expect.poll(async () => strip.getAttribute("data-state"),
    { timeout: 30_000 }).toBe("compiling");
  console.log("DURING:", await strip.getAttribute("data-state"), "|", await strip.innerText());

  // The tab goes deaf while the server carries on and finishes the build.
  await tab.context().setOffline(true);
  await tab.waitForTimeout(12_000);
  console.log("OFFLINE 12s:", await strip.getAttribute("data-state"), "|", await strip.innerText());

  // And comes back.  The stream reconnects; does anything correct the strip?
  await tab.context().setOffline(false);
  for (const n of [1, 2, 3, 4]) {
    await tab.waitForTimeout(8000);
    console.log(`BACK ${n * 8}s:`, await strip.getAttribute("data-state"),
      "|", await strip.innerText());
  }
  await tab.screenshot({ path: "/tmp/review-shots/a1-offline.png" });
});
