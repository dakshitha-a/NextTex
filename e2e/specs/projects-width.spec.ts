import { test, expect } from "../fixtures";
import { seedProject } from "../server";

/** The projects screen keeps a reading width on a wide window.
 *
 *  Raised by the writer: on a full-screen ultrawide the rows ran the
 *  whole window, the name at one end and its time some two thousand
 *  pixels away at the other.  The head and the rows keep to one centred
 *  column of at most 1040 px; the app bar is the frame and stays full
 *  width; the list still scrolls at the window's edge.
 */

test("on a 2560 px window the head and the rows share one centred 1040 px column", async ({ app, page }) => {
  await seedProject(app, "thesis");
  await page.setViewportSize({ width: 2560, height: 1000 });
  await page.goto(`${app.base}/?token=${app.token}`);
  const row = page.getByTestId("project-row").first();
  await row.waitFor();

  const box = (await row.boundingBox())!;
  expect(box.width).toBeLessThanOrEqual(1040);
  expect(Math.abs(box.x + box.width / 2 - 1280)).toBeLessThanOrEqual(2);
  // New project ends where the rows end, so the head acts on the column.
  const button = (await page.getByTestId("new-project").boundingBox())!;
  expect(button.x + button.width).toBeLessThanOrEqual(box.x + box.width + 1);
  expect(button.x).toBeGreaterThan(box.x);
  // The list itself is the full width, so its scrollbar is at the edge.
  const list = (await page.getByTestId("project-list").boundingBox())!;
  expect(list.width).toBeGreaterThan(2500);
});

test("on an ordinary window the rows fill the width less the gutters, as before", async ({ app, page }) => {
  await seedProject(app, "thesis");
  await page.setViewportSize({ width: 1024, height: 800 });
  await page.goto(`${app.base}/?token=${app.token}`);
  const row = page.getByTestId("project-row").first();
  await row.waitFor();
  const box = (await row.boundingBox())!;
  expect(box.x).toBe(40);
  expect(box.width).toBe(1024 - 80);
});
