import { test, expect } from "../fixtures";
import { seedProject } from "../server";

/** The projects screen when there is a real number of projects on it.
 *
 *  Every other spec seeds one project, so nothing had ever looked at the
 *  screen with twelve, and then with thirty. The screen used to be one
 *  sheet that scrolled as a whole, so with that many the ways in, the cog
 *  and the update were above or below the window. It is a rail beside
 *  the list now, and the list is the only thing that scrolls: everything
 *  that is not a project is on screen however long the list is.
 */

const NAMES = [
  "thesis", "conical-intersections-paper", "grant-proposal-2027",
  "lecture-notes-quantum-dynamics", "notes", "review-response",
  "chapter-3-draft", "poster-acs", "cv", "collab-with-maria",
  "old-thesis-backup", "figures-for-the-talk",
];

/** The rows in the order the sort by name draws them: case folded,
 *  digits as numbers, the collator the screen uses. */
const BY_NAME = [...NAMES].sort((a, b) =>
  a.localeCompare(b, undefined, { sensitivity: "base", numeric: true }),
);

test("the rail stays put while thirty projects scroll", async ({ app, page }) => {
  for (let i = 0; i < 30; i++) await seedProject(app, `paper-${String(i).padStart(2, "0")}`);
  await page.setViewportSize({ width: 1680, height: 1000 });
  await page.goto(`${app.base}/?token=${app.token}`);
  await page.getByText("Projects", { exact: true }).waitFor();
  await expect(page.getByTestId("project-row")).toHaveCount(30);

  // The list overflows, and it is the list that scrolls, not the screen.
  const list = page.getByTestId("project-list");
  const scrolls = await list.evaluate((el) => el.scrollHeight > el.clientHeight);
  expect(scrolls).toBe(true);
  const screen = await page.locator(".nx-projects").evaluate(
    (root) => root.scrollHeight - root.clientHeight,
  );
  expect(screen).toBe(0);

  // Everything that is not a project is on screen without a scroll, and
  // stays there once the list has been scrolled to its end.
  await list.evaluate((el) => el.scrollTo(0, el.scrollHeight));
  const top = await page.locator("h1").evaluate((h1) => h1.getBoundingClientRect().top);
  expect(top).toBeGreaterThanOrEqual(0);
  await expect(page.getByRole("button", { name: "Start something new" })).toBeInViewport();
  await expect(page.getByRole("button", { name: "Join a shared project" })).toBeInViewport();
  await expect(page.getByTestId("project-filter")).toBeInViewport();
  await expect(page.getByTestId("project-sort")).toBeInViewport();
  const cog = page.getByTestId("appearance");
  await expect(cog).toBeInViewport();
  await cog.click();
  await expect(cog).toHaveAttribute("aria-expanded", "true");
});

test("one project still has the search and the sort", async ({ app, project, page }) => {
  await page.setViewportSize({ width: 1680, height: 1000 });
  await page.goto(`${app.base}/?token=${app.token}`);
  await page.getByText("Projects", { exact: true }).waitFor();
  await expect(page.getByText(project.root.split("/").pop()!, { exact: true })).toBeVisible();
  // Whatever the count: a control that appears at six is one nobody has
  // learned by the time they need it.
  const filter = page.getByTestId("project-filter");
  await expect(filter).toBeVisible();
  await page.locator("h1").click();
  await page.keyboard.press("/");
  await expect(filter).toBeFocused();
  await expect(page.getByTestId("project-sort")).toHaveValue("recent");
});


test("a row says when it was opened, and its actions are there without a hover", async ({
  app, project, page,
}) => {
  await page.goto(`${app.base}/?token=${app.token}`);
  await page.getByText("Projects", { exact: false }).first().waitFor();
  const row = page.getByTestId("project-row").first();
  // Registered a moment ago counts as opened a moment ago; the registry
  // stamps an entry when it is added.
  await expect(row.getByTestId("row-opened")).toHaveText("just now");
  // The path is folded to `~` when it is under home; the sandbox is not,
  // so the row shows it whole, and the title carries the whole path.
  await expect(row.locator("[title]").first()).toHaveAttribute("title", project.root);

  // At rest the actions are not drawn, and they are still real buttons:
  // a keyboard reaches them and a click lands without a hover first.
  const actions = row.getByTestId("row-actions");
  await expect(actions).toHaveCSS("opacity", "0");
  await page.mouse.move(0, 0);
  await actions.getByRole("button", { name: "Remove" }).click();
  await expect(row.getByText("Remove from NextTex?")).toBeVisible();
  await row.getByRole("button", { name: "Keep" }).click();

  // Pointed at, the actions are drawn and the time gives way to them.
  await row.hover();
  await expect(actions).toHaveCSS("opacity", "1");
  await expect(row.getByTestId("row-opened")).toHaveCSS("opacity", "0");
});

test("the ways in stand in the rail beside the list, and the search finds a row", async ({ app, page }) => {
  for (const name of NAMES) await seedProject(app, name);
  await page.setViewportSize({ width: 1680, height: 1000 });
  await page.goto(`${app.base}/?token=${app.token}`);
  await page.getByText("Projects", { exact: true }).waitFor();
  await expect(page.getByTestId("project-count")).toHaveText(String(NAMES.length));

  // Beside, not under: the create form and the brand are both on screen
  // without a scroll, and the form sits to the left of the list.
  const name = page.getByPlaceholder("What is it called?");
  await expect(name).toBeInViewport();
  await expect(page.locator("h1")).toBeInViewport();
  const list = await page.getByTestId("project-row").first().boundingBox();
  const form = await name.boundingBox();
  expect(form!.x + form!.width).toBeLessThanOrEqual(list!.x);

  // The three ways in are still the same three buttons.
  for (const tab of ["Start something new", "Point at a folder", "Join a shared project"]) {
    await expect(page.getByRole("button", { name: tab })).toBeVisible();
  }

  // `/` reaches the filter from anywhere that is not a field; typing
  // narrows the rows; Enter opens the first one left.
  await page.locator("h1").click();
  await page.keyboard.press("/");
  const filter = page.getByTestId("project-filter");
  await expect(filter).toBeFocused();
  await page.keyboard.type("grant");
  await expect(page.getByTestId("project-row")).toHaveCount(1);
  await expect(page.getByTestId("project-row")).toContainText("grant-proposal-2027");
  await page.keyboard.type(" nowhere");
  await expect(page.getByTestId("no-match")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(filter).toHaveValue("");
  await expect(page.getByTestId("project-row")).toHaveCount(NAMES.length);
  await page.keyboard.type("grant");
  await page.keyboard.press("Enter");
  await expect(page.locator(".cm-editor")).toBeVisible({ timeout: 30_000 });
});

test("on a phone the rail is a strip and the ways in are a drawer behind New", async ({
  app, page,
}) => {
  for (const name of NAMES) await seedProject(app, name);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${app.base}/?token=${app.token}`);
  await page.getByText("Projects", { exact: true }).waitFor();
  await expect(page.getByTestId("project-row")).toHaveCount(NAMES.length);

  const wide = await page.locator(".nx-projects").evaluate(
    (root) => root.scrollWidth - root.clientWidth,
  );
  expect(wide).toBe(0);

  // The three ways in are behind New until asked for.
  const start = page.getByRole("button", { name: "Start something new" });
  await expect(start).toBeHidden();
  const open = page.getByTestId("ways-open");
  await expect(open).toBeVisible();
  await open.click();
  const drawer = page.getByRole("dialog", { name: "Ways in" });
  await expect(drawer).toBeVisible();
  for (const tab of ["Start something new", "Point at a folder", "Join a shared project"]) {
    await expect(drawer.getByRole("button", { name: tab })).toBeVisible();
  }
  // A dialog: focus is inside it, Escape closes it and hands focus back to
  // the button that opened it.
  const inside = await drawer.evaluate((el) => el.contains(document.activeElement));
  expect(inside).toBe(true);
  await page.keyboard.press("Escape");
  await expect(drawer).toBeHidden();
  await expect(open).toBeFocused();

  // The search stays put while the list scrolls under it.
  const list = page.getByTestId("project-list");
  await list.evaluate((el) => el.scrollTo(0, el.scrollHeight));
  await expect(page.getByTestId("project-filter")).toBeInViewport();
  await expect(open).toBeInViewport();
});

test("the create form does not run off a phone", async ({ app, project, page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${app.base}/?token=${app.token}`);
  await page.getByText(project.root.split("/").pop()!, { exact: true }).waitFor();
  await page.getByTestId("ways-open").click();
  // The folder field, the template chooser and the button were one row
  // that could not shrink below 445px, so the sheet scrolled sideways.
  const wide = await page.locator(".nx-projects").evaluate(
    (root) => root.scrollWidth - root.clientWidth,
  );
  expect(wide).toBe(0);
  await expect(page.getByRole("button", { name: "Create project" })).toBeInViewport();
});

test("the arrow keys walk the list, and the filter cannot strand the focus", async ({
  app, page,
}) => {
  for (const name of NAMES) await seedProject(app, name);
  await page.setViewportSize({ width: 1680, height: 1000 });
  await page.goto(`${app.base}/?token=${app.token}`);
  await page.getByText("Projects", { exact: true }).waitFor();
  await expect(page.getByTestId("project-row")).toHaveCount(NAMES.length);

  // One Tab stop for the whole list, the file tree's idiom: every row
  // but one is tabIndex -1, and the arrows move inside.
  const rows = page.getByTestId("project-row");
  await expect(page.locator('[data-testid="project-row"][tabindex="0"]')).toHaveCount(1);
  await expect(page.locator('[data-testid="project-row"][tabindex="-1"]')).toHaveCount(NAMES.length - 1);
  await rows.first().focus();
  await expect(rows.first()).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowDown");
  await expect(rows.nth(2)).toBeFocused();
  await page.keyboard.press("End");
  await expect(rows.last()).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(rows.last()).toBeFocused();
  await page.keyboard.press("Home");
  await expect(rows.first()).toBeFocused();
  await page.keyboard.press("ArrowUp");
  await expect(rows.first()).toBeFocused();

  // A row's own buttons stay in the tab order, and an arrow pressed on
  // one of them is not the list's to take.
  await page.keyboard.press("Tab");
  await expect(rows.first().getByRole("button").first()).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(rows.first().getByRole("button").first()).toBeFocused();

  // Focus a row, then filter it away: the stop moves to the first row
  // still showing rather than to nothing, and Down from the box lands
  // on it.
  await rows.nth(4).focus();
  await expect(rows.nth(4)).toBeFocused();
  const filter = page.getByTestId("project-filter");
  await filter.focus();
  await page.keyboard.type("thesis");
  await expect(rows).toHaveCount(2);
  await page.keyboard.press("ArrowDown");
  await expect(rows.first()).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(rows.nth(1)).toBeFocused();

  // Sorted by name, the arrows walk the sorted order: the first row is
  // the first name, and Down from the box lands on it.
  await filter.focus();
  await page.keyboard.press("Escape");
  await expect(rows).toHaveCount(NAMES.length);
  await page.getByTestId("project-sort").selectOption("name");
  await expect(rows.first()).toContainText(BY_NAME[0]);
  await filter.focus();
  await page.keyboard.press("ArrowDown");
  await expect(rows.first()).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(rows.nth(1)).toBeFocused();
  await expect(rows.nth(1)).toContainText(BY_NAME[1]);
  await page.keyboard.press("Enter");
  await expect(page.locator(".cm-editor")).toBeVisible({ timeout: 30_000 });
});

test("sort by name reorders the rows and is remembered", async ({ app, page }) => {
  // A few milliseconds between seeds, so no two share a stamp and the
  // recent order is exactly the reverse of the seeding.  A tie is
  // broken by name on the server, which the unit test pins; here the
  // whole order is asserted rather than its ends.
  for (const name of NAMES) {
    await seedProject(app, name);
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  await page.setViewportSize({ width: 1680, height: 1000 });
  await page.goto(`${app.base}/?token=${app.token}`);
  await page.getByText("Projects", { exact: true }).waitFor();
  const rows = page.getByTestId("project-row");
  await expect(rows).toHaveCount(NAMES.length);
  const names = async () =>
    rows.evaluateAll((els) =>
      els.map((el) => el.querySelector("[data-testid=project-name]")!.textContent),
    );
  const BY_RECENT = [...NAMES].reverse();

  // The server's order first: most recently registered at the top.
  const sort = page.getByTestId("project-sort");
  await expect(sort).toHaveValue("recent");
  expect(await names()).toEqual(BY_RECENT);

  await sort.selectOption("name");
  expect(await names()).toEqual(BY_NAME);

  // Kept on this browser: a reload comes back sorted the same way.
  await page.reload();
  await page.getByText("Projects", { exact: true }).waitFor();
  await expect(rows).toHaveCount(NAMES.length);
  await expect(sort).toHaveValue("name");
  expect(await names()).toEqual(BY_NAME);

  await sort.selectOption("recent");
  expect(await names()).toEqual(BY_RECENT);
});

test("leaving a project ends its event stream, so the list stops calling it open", async ({
  app, project, browser, page,
}) => {
  // Two windows: A opens the project, B reads the list.
  await page.goto(`${app.base}/?token=${app.token}`);
  await page.getByText("Projects", { exact: false }).first().waitFor();
  await page.getByText(project.root.split("/").pop()!, { exact: true }).click();
  await page.locator(".cm-editor").waitFor({ timeout: 45_000 });

  const other = await browser.newContext();
  const list = await other.newPage();
  await list.goto(`${app.base}/?token=${app.token}`);
  await list.getByText("Projects", { exact: false }).first().waitFor();
  const watched = async () =>
    (await (await list.request.get(`${app.base}/api/projects`)).json()).watched as string[];
  expect(await watched()).toEqual([project.id]);

  // A goes back to the list. Its event stream ends there and then, not
  // when the tab closes, so the server stops counting the project as
  // held by a browser: the row the reader has just come from is not
  // "open in another window", and the reaper can evict the session it
  // left behind.
  await page.getByTestId("switch-project").click();
  await page.getByText("Projects", { exact: true }).waitFor();
  await expect.poll(watched, { timeout: 10_000 }).toEqual([]);
  await other.close();
});

test("a row says the project is open in another window, and only while it is", async ({
  app, project, browser, page,
}) => {
  // Two windows: A opens the project, B reads the list.
  await page.goto(`${app.base}/?token=${app.token}`);
  await page.getByText("Projects", { exact: false }).first().waitFor();
  await page.getByText(project.root.split("/").pop()!, { exact: true }).click();
  await page.locator(".cm-editor").waitFor({ timeout: 45_000 });

  const other = await browser.newContext();
  const list = await other.newPage();
  await list.goto(`${app.base}/?token=${app.token}`);
  await list.getByText("Projects", { exact: false }).first().waitFor();
  const row = list.getByTestId("project-row").first();
  await expect(row).toContainText("open in another window");

  // A goes back to the list, its stream ends (the test above), and B's
  // next look at the list finds the mark gone. The mark is as of the
  // last fetch, so B has to look again: the list holds no stream.
  await page.getByTestId("switch-project").click();
  await page.getByText("Projects", { exact: true }).waitFor();
  await expect
    .poll(async () => (await (await list.request.get(`${app.base}/api/projects`)).json()).watched, {
      timeout: 10_000,
    })
    .toEqual([]);
  await list.reload();
  await list.getByText("Projects", { exact: false }).first().waitFor();
  await expect(list.getByTestId("project-row").first()).not.toContainText("open in another window");
  await other.close();
});
