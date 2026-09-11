import { test, expect } from "../fixtures";
import { startServer, seedProject } from "../server";

/** What a tab shows when the server it is talking to goes away mid-build. */
test("the tab after the server goes away mid-build", async ({ page }) => {
  const app = await startServer();
  const project = await seedProject(app, `gone-${Date.now()}`);
  await page.goto(`${app.base}/?token=${app.token}`);
  await page.getByText("Projects", { exact: false }).first().waitFor();
  await page.getByText(project.root.split("/").pop()!, { exact: false }).first().click();
  await page.locator(".cm-editor").waitFor({ timeout: 20_000 });
  const strip = page.locator('[data-testid="status"]');
  await expect.poll(async () => strip.getAttribute("data-state"),
    { timeout: 90_000 }).toBe("built");
  console.log("BEFORE:", await strip.getAttribute("data-state"));

  await page.locator(".cm-content").click();
  await page.keyboard.type("x");
  await expect.poll(async () => strip.getAttribute("data-state"),
    { timeout: 30_000 }).toBe("compiling");
  console.log("DURING:", await strip.getAttribute("data-state"));

  await app.stop().catch(() => undefined);
  for (const n of [1, 2, 3]) {
    await page.waitForTimeout(6000);
    const strips = await page.locator('[data-testid="status"]').count();
    const state = strips ? await page.locator('[data-testid="status"]').getAttribute("data-state") : "(strip gone)";
    const editors = await page.locator(".cm-editor").count();
    const body = (await page.locator("body").innerText().catch(() => "")).replace(/\n+/g, " | ");
    console.log(`AFTER ${n * 6}s: strip=${state} editors=${editors}`);
    console.log(`  body: ${body.slice(0, 220)}`);
    await page.screenshot({ path: `/tmp/review-shots/a1-gone-${n}.png` });
  }
});
