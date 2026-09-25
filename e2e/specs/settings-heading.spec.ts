import { test, expect } from "../fixtures";

/** The settings pane's heading on a phone.
 *
 *  It shared its line with the note saying where the settings live, and
 *  at 390 px "How it looks" went to two lines.  The heading never wraps
 *  now; narrow, the note drops under it and the close stays beside it.
 */

test("on a phone the heading is one line, the note under it, the close beside it", async ({ page, app }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${app.base}/?token=${app.token}`);
  await page.getByTestId("appearance").first().click();
  const sheet = page.getByRole("dialog", { name: "Settings" });
  await expect(sheet).toBeVisible();
  const heading = sheet.locator(".nx-settings-head > h2");
  await expect(heading).toHaveText("How it looks");
  const h = (await heading.boundingBox())!;
  const lineHeight = await heading.evaluate((el) => parseFloat(getComputedStyle(el).lineHeight));
  expect(h.height).toBeLessThanOrEqual(lineHeight + 1);
  const where = (await sheet.locator(".nx-settings-where").boundingBox())!;
  expect(where.y).toBeGreaterThanOrEqual(h.y + h.height - 1);
  const close = (await sheet.getByTestId("settings-close").boundingBox())!;
  expect(close.y).toBeLessThan(where.y);
});
