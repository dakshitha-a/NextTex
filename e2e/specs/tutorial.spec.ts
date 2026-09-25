import { test, expect } from "../fixtures";

/** The tutorial and the screen guide, after the overhaul.
 *
 *  The writer's two conditions on the drawings they approved: the
 *  tutorials are up to date and visually consistent, and they close with
 *  Esc.  Up to date is read as the absence of the words the old interface
 *  had and the presence of the new one's; consistent is the panel's own
 *  classes rather than a bordered box; Esc is pressed.
 */

const STALE = [/\bcog\b/i, /\brail\b/i, /\btile\b/i, /file list/i, /accordion/i, /masthead/i];

test("the tutorial opens from Settings, names the bar and the drawer, and closes with Escape", async ({ tab }) => {
  await tab.getByTestId("appearance").first().click();
  await tab.getByTestId("tutorial-open").click();
  const panel = tab.getByTestId("tutorial");
  await expect(panel).toBeVisible();
  await expect(panel.getByRole("heading", { name: "Tutorial" })).toBeVisible();

  // Every section is listed, in order.
  await tab.getByTestId("tutorial-contents").click();
  await expect(tab.getByTestId("tutorial-contents-row")).toHaveCount(11);
  await expect(tab.getByTestId("tutorial-contents-row").first()).toHaveText(/The four panes/);
  await expect(tab.getByTestId("tutorial-contents-row").last()).toHaveText(/Keyboard/);
  await tab.keyboard.press("Escape");
  await expect(tab.getByTestId("tutorial-contents-row")).toHaveCount(0);
  await expect(panel).toBeVisible();

  // Up to date: what it says is the app as built.
  const text = (await panel.innerText()) ?? "";
  for (const stale of STALE) expect(text, `the tutorial still says ${stale}`).not.toMatch(stale);
  for (const fresh of [/\bbar\b/, /\bdrawer\b/, /What writes with you/, /archived/, /Before you submit/, /Deleted/, /eleven buttons/, /People/, /Build/, /Download/]) {
    expect(text, `the tutorial does not mention ${fresh}`).toMatch(fresh);
  }
  // Consistent: the panel on the second surface, no border, the float.
  const look = await panel.evaluate((el) => {
    const s = getComputedStyle(el);
    return { border: s.borderLeftWidth, shadow: s.boxShadow !== "none" };
  });
  expect(look.border).toBe("0px");
  expect(look.shadow).toBe(true);

  // Esc closes it.
  await tab.keyboard.press("Escape");
  await expect(panel).toHaveCount(0);
});

test("Escape inside a sheet over the tutorial closes the sheet, and the next one the tutorial", async ({ tab }) => {
  await tab.getByTestId("appearance").first().click();
  await tab.getByTestId("tutorial-open").click();
  await expect(tab.getByTestId("tutorial")).toBeVisible();
  // The report sheet, from the drawer's foot: sharing is a drawer, not a
  // sheet, inside a project now.
  await tab.getByTestId("report-problem").click();
  const sheet = tab.getByTestId("report-sheet");
  await expect(sheet).toBeVisible();
  await tab.keyboard.press("Escape");
  await expect(sheet).toHaveCount(0);
  await expect(tab.getByTestId("tutorial")).toBeVisible();
  await tab.keyboard.press("Escape");
  await expect(tab.getByTestId("tutorial")).toHaveCount(0);
});

test("the screen guide names the list as it is and closes with Escape", async ({ app, page }) => {
  await page.goto(`${app.base}/?token=${app.token}`);
  await page.getByRole("heading", { name: "Projects" }).waitFor();
  await page.getByTestId("about-screen").click();
  const guide = page.getByTestId("screen-guide");
  await expect(guide).toBeVisible();
  await expect(guide.getByText("This screen")).toBeVisible();
  const text = (await guide.innerText()) ?? "";
  for (const stale of STALE) expect(text, `the guide still says ${stale}`).not.toMatch(stale);
  for (const fresh of [/New project/, /Other ways in/, /Archive/, /trash/i, /What writes with you/, /Settings/]) {
    expect(text, `the guide does not mention ${fresh}`).toMatch(fresh);
  }
  await page.keyboard.press("Escape");
  await expect(guide).toHaveCount(0);
  await expect(page.getByTestId("about-screen")).toBeFocused();
});
