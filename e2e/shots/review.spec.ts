import { test, expect } from "../fixtures";

/** Not a check — a look. Renders the states I have only asserted on. */

test("sign-in choices", async ({ app, page }) => {
  // Nobody signed in, so the first screen is the one a new install shows.
  await fetch(`${app.base}/api/agent/provider`, {
    method: "POST",
    headers: { "content-type": "application/json",
               "x-nexttex-token": app.token },
    body: JSON.stringify({ provider: "openai", key: "" }),
  });
  await page.goto(`${app.base}/?token=${app.token}`);
  await page.evaluate(() => window.localStorage.setItem("nexttex.theme", "dark"));
  await page.reload();
  await expect(page.getByText("How would you like to work?")).toBeVisible({
    timeout: 20_000,
  });
  await page.screenshot({ path: "shots/out-signin.png",
                          clip: { x: 380, y: 120, width: 620, height: 500 } });
});

test("no agent at all", async ({ app, project, page }) => {
  // The harness signs the Claude provider in, so there is no sign-in
  // screen to click through; set the choice directly instead.
  await fetch(`${app.base}/api/agent/provider`, {
    method: "POST",
    headers: { "content-type": "application/json",
               "x-nexttex-token": app.token },
    body: JSON.stringify({ provider: "none" }),
  });
  await page.goto(`${app.base}/?token=${app.token}`);
  await page.getByText(project.root.split("/").pop()!, { exact: false })
    .first().click();
  await expect(page.locator(".cm-editor")).toBeVisible({ timeout: 30_000 });
  await page.waitForTimeout(3000);
  await page.screenshot({ path: "shots/out-noagent.png" });
});

test("an error explained", async ({ tab }) => {
  await expect(tab.locator(".cm-editor")).toBeVisible({ timeout: 30_000 });
  await tab.locator(".cm-content").click();
  await tab.keyboard.press("Control+End");
  await tab.getByText("What the results mean").click();
  await tab.keyboard.press("End");
  await tab.keyboard.type("\nA stray underscore_here and \\nosuchcommand");
  await expect(tab.getByText(/error/i).first()).toBeVisible({ timeout: 45_000 });
  await tab.getByTestId("status").click();
  await tab.waitForTimeout(600);
  const rows = tab.locator('[role="button"][aria-expanded]');
  if (await rows.count()) await rows.first().click();
  await tab.waitForTimeout(400);
  await tab.screenshot({ path: "shots/out-errors.png",
                         clip: { x: 240, y: 620, width: 1100, height: 380 } });
});
