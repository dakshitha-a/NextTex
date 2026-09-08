import { test, expect } from "@playwright/test";
import { startServer, type Instance } from "../server";

/** Setting a password, from the nudge on the project list.
 *
 *  Its own server rather than the shared fixture, because a password is
 *  persisted to `config.json`: every later test sharing that instance would
 *  arrive at the sign-in page instead of the app. For the same reason this
 *  is one test rather than several -- the first one to save a password
 *  changes what the next one would see.
 *
 *  What is being checked is not that the password saves -- `tests/api`
 *  covers that -- but that the card gets out of the way afterwards. It used
 *  to stay put, and worse, re-read the settings and re-render as *"Change
 *  the password"* with a Current password field in it, so the writer who had
 *  just set one was looking at a screen that implied it had not worked.
 */

let app: Instance;

test.beforeAll(async () => {
  app = await startServer();
});

test.afterAll(async () => {
  await app?.stop();
});

test("setting a password says so and closes itself", async ({ page }) => {
  await page.goto(`${app.base}/?token=${app.token}`);

  await page.getByTestId("set-password").click();
  const card = page.getByTestId("access-card");
  await expect(card).toBeVisible();

  // The password box had no label at all in this mode -- the heading above
  // the form was doing the work visually, which leaves anyone navigating by
  // name with an unnamed password box.
  await expect(card.getByText("Password", { exact: true })).toBeVisible();

  await card.getByTestId("display-name").fill("Dakshitha");
  const boxes = card.locator('input[type="password"]');
  await boxes.nth(0).fill("a-long-enough-one");
  await boxes.nth(1).fill("a-long-enough-one");
  await card.getByTestId("save-password").click();

  // It says what happened, by name...
  const done = page.getByTestId("access-done");
  await expect(done).toBeVisible();
  await expect(done).toContainText("Dakshitha");
  // ...and nothing that is now beside the point is still on screen.
  await expect(card.getByTestId("save-password")).toHaveCount(0);
  await expect(card.getByText("Current password")).toHaveCount(0);

  await page.screenshot({ path: "shots/out-password-set.png" });

  // Nobody pressed Close.
  await expect(page.getByTestId("access-card")).toHaveCount(0, { timeout: 6_000 });
  // And the thing that asked for a password stops asking.
  await expect(page.getByTestId("password-nudge")).toHaveCount(0);
});
