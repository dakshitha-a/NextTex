import { test, expect } from "../fixtures";
import { seedProject } from "../server";

/** The projects screen when there is a real number of projects on it.
 *
 *  Every other spec seeds one project, so nothing had ever looked at the
 *  screen with twelve, and then with thirty. The list is the screen: an
 *  app bar above, the head with the find field and New project, and the
 *  list as the only thing that scrolls, so everything that is not a
 *  project is on screen however long the list is.
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

test("the app bar and the head stay put while thirty projects scroll", async ({ app, page }) => {
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
  await expect(page.getByTestId("new-project")).toBeInViewport();
  await expect(page.getByTestId("ways-open")).toBeInViewport();
  await expect(page.getByTestId("project-filter")).toBeInViewport();
  await expect(page.getByTestId("update-open")).toBeInViewport();
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
  await expect(page.getByTestId("sort-recent")).toHaveAttribute("aria-pressed", "true");
});


test("the rows run the width the head runs", async ({ app, project, page }) => {
  // At a width where the head has room to spare, a row that stopped short
  // of it left the hovered row's actions well inside New project's edge.
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto(`${app.base}/?token=${app.token}`);
  await page.getByText("Projects", { exact: true }).waitFor();
  const row = page.getByTestId("project-row").first();
  await expect(row).toBeVisible();
  const head = await page.locator(".nx-projects-head").boundingBox();
  const box = await row.boundingBox();
  // The head's side padding is 40 px; the row's right edge lands where its
  // last control's does.
  expect(Math.abs(box!.x + box!.width - (head!.x + head!.width - 40))).toBeLessThan(2);
  void project; // taken so the fixture seeds a row
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
  // Two things: Share, and More for the rest. Open is not among them,
  // since a press anywhere on the row opens the project.
  await expect(actions.getByRole("button")).toHaveText(["Share", ""]);
  await expect(actions.getByRole("button", { name: "More" })).toBeVisible();
  await actions.getByRole("button", { name: "More" }).click();
  const menu = page.getByTestId("row-menu");
  await expect(menu.getByRole("menuitem")).toHaveText([
    "Download as a zip", "Download the PDF", "Duplicate", "Archive", "Move to the trash",
  ]);
  // The trash is last, after a rule, in the error ink.
  await expect(menu.getByRole("separator")).toHaveCount(1);
  await expect(menu.getByRole("menuitem", { name: "Move to the trash" })).toHaveAttribute("data-danger", "true");
  // While the menu is open the row keeps its actions drawn.
  await page.mouse.move(0, 0);
  await expect(actions).toHaveCSS("opacity", "1");
  await menu.getByRole("menuitem", { name: "Archive" }).click();
  // Archiving asks nothing: it is reversible.  The row leaves the list
  // and the quiet line under it says where it went.
  await expect(page.getByTestId("project-row")).toHaveCount(0);
  await page.getByTestId("view-archived").click();
  await expect(page.getByRole("heading", { name: "Archived" })).toBeVisible();
  await page.getByTestId("project-row").first().hover();
  await page.getByTestId("row-restore").click();
  await page.getByTestId("view-back").click();
  await expect(page.getByTestId("project-row")).toHaveCount(1);

  // Pointed at, the actions are drawn and the time gives way to them.
  await row.hover();
  await expect(actions).toHaveCSS("opacity", "1");
  await expect(row.getByTestId("row-opened")).toHaveCSS("opacity", "0");
});

test("the other ways in are a menu with a line each, and the search finds a row", async ({ app, page }) => {
  for (const name of NAMES) await seedProject(app, name);
  await page.setViewportSize({ width: 1680, height: 1000 });
  await page.goto(`${app.base}/?token=${app.token}`);
  await page.getByText("Projects", { exact: true }).waitFor();
  await expect(page.getByTestId("project-count")).toHaveText(`${NAMES.length} projects`);

  // One filled button, and the other three ways behind a quiet menu,
  // each saying what it does; choosing one opens the sheet for it.
  await expect(page.getByTestId("new-project")).toBeVisible();
  await page.getByTestId("ways-open").click();
  const menu = page.getByTestId("ways-menu");
  await expect(menu).toBeVisible();
  for (const way of ["Open a folder", "Join a shared project", "Bring one from elsewhere"]) {
    await expect(menu.getByRole("menuitem", { name: new RegExp(way) })).toBeVisible();
  }
  await expect(menu).toContainText("Nothing is copied or moved.");
  await menu.getByRole("menuitem", { name: /Join a shared project/ }).click();
  const sheet = page.getByTestId("way-form");
  await expect(sheet).toBeVisible();
  await expect(sheet.getByTestId("invite-input")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(sheet).toHaveCount(0);

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

test("on a phone the head wraps, and the other ways in are a sheet", async ({
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

  // The other ways in are a sheet here, where a menu would be a strip
  // of the screen.
  const open = page.getByTestId("ways-open");
  await expect(open).toBeVisible();
  await open.click();
  const drawer = page.getByRole("dialog", { name: "Other ways in" });
  await expect(drawer).toBeVisible();
  for (const way of ["Open a folder", "Join a shared project", "Bring one from elsewhere"]) {
    await expect(drawer.getByRole("button", { name: new RegExp(way) })).toBeVisible();
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

test("the New project sheet does not run off a phone", async ({ app, project, page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${app.base}/?token=${app.token}`);
  await page.getByText(project.root.split("/").pop()!, { exact: true }).waitFor();
  await page.getByTestId("new-project").click();
  const sheet = page.getByTestId("way-form");
  await expect(sheet).toBeVisible();
  const wide = await page.locator(".nx-projects").evaluate(
    (root) => root.scrollWidth - root.clientWidth,
  );
  expect(wide).toBe(0);
  const box = (await sheet.boundingBox())!;
  expect(box.x + box.width).toBeLessThanOrEqual(390);
  await expect(page.getByRole("button", { name: "Create project" })).toBeInViewport();
  // The fifth template wraps onto a second row rather than leaving the
  // sheet: every choice is inside the sheet's box.
  for (const choice of await page.getByTestId("template-choice").getByRole("button").all()) {
    const at = (await choice.boundingBox())!;
    expect(at.x + at.width).toBeLessThanOrEqual(box.x + box.width);
    expect(at.x).toBeGreaterThanOrEqual(box.x);
  }
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
  await page.getByTestId("sort-name").click();
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
  await expect(page.getByTestId("sort-recent")).toHaveAttribute("aria-pressed", "true");
  expect(await names()).toEqual(BY_RECENT);

  await page.getByTestId("sort-name").click();
  expect(await names()).toEqual(BY_NAME);

  // Kept on this browser: a reload comes back sorted the same way.
  await page.reload();
  await page.getByText("Projects", { exact: true }).waitFor();
  await expect(rows).toHaveCount(NAMES.length);
  await expect(page.getByTestId("sort-name")).toHaveAttribute("aria-pressed", "true");
  expect(await names()).toEqual(BY_NAME);

  await page.getByTestId("sort-recent").click();
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
  // And A's own list never calls the row it came from open in another
  // window, however the fetch and the disconnect are ordered: the window
  // it is open in is this one.
  await expect(page.getByTestId("project-row").first()).toBeVisible();
  await expect(page.getByText("open in another window")).toHaveCount(0);
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
