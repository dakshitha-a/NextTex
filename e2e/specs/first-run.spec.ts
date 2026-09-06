import { test, expect } from "../fixtures";

test("a link without the token asks for it rather than showing the app", async ({
  app, page,
}) => {
  await page.goto(app.base);
  await expect(page.locator("body")).toContainText(/token/i);
});

test("the token in a link gets the writer in, and leaves the bar clean", async ({
  app, page,
}) => {
  await page.goto(`${app.base}/?token=${app.token}`);
  await expect(page.locator("body")).toContainText(/project/i);
  // The token is a credential; leaving it in the address bar is how it ends
  // up in a screenshot or a shared link.
  expect(page.url()).not.toContain("token=");
});

test("a project opens from anywhere in its row", async ({ app, project, page }) => {
  await page.goto(`${app.base}/?token=${app.token}`);
  const row = page.getByText(project.root.split("/").pop()!, { exact: false }).first();
  await row.click();
  await expect(page.locator(".cm-editor")).toBeVisible({ timeout: 20_000 });
});
