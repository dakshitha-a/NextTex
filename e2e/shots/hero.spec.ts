import { test as base, expect, openProject } from "../fixtures";
import type { Locator, Page } from "@playwright/test";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ROOT, startServer, type Instance } from "../server";
import { plot } from "../png";

/** The README's screenshots, captured against a real instance rather than
 *  mocked up.
 *
 *  Outside `specs/` on purpose, so no tier picks it up: it writes files
 *  into the repository, and it is two more browsers competing for the
 *  machine during a run that already starts a server and a LaTeX build per
 *  spec.  Run it by hand when the interface changes:
 *
 *      cd e2e && node_modules/.bin/playwright test --config shots.config.ts shots/hero.spec.ts
 *
 *  Thirteen pictures come out of it: the three hero shots of the
 *  workspace, and five pairs (light and dark) of the surfaces the README
 *  talks about, the projects screen, the settings sheet, the Claude column
 *  mid-turn, the two hover cards, and the share sheet. */

/** The projects live under a home directory made for the run, so a row's
 *  location reads `~/papers/...` in the picture rather than the path of a
 *  temporary directory.  The server folds `Path.home()`, which is `HOME`,
 *  so `HOME` is redirected for it; a TinyTeX under the real home is
 *  linked into the made one so a TeX found that way is still found. */
type Shots = { home: string; app: Instance; tab: Page };

const test = base.extend<Shots>({
  home: async ({}, use) => {
    const home = mkdtempSync(join(tmpdir(), "nexttex-home-"));
    mkdirSync(join(home, "papers"), { recursive: true });
    for (const tex of [".TinyTeX", "Library/TinyTeX"]) {
      const real = join(process.env.HOME ?? "", tex);
      if (process.env.HOME && existsSync(real)) {
        mkdirSync(join(home, tex, ".."), { recursive: true });
        symlinkSync(real, join(home, tex));
      }
    }
    await use(home);
    rmSync(home, { recursive: true, force: true });
  },
  app: async ({ home }, use) => {
    const instance = await startServer({ HOME: home });
    await use(instance);
    await instance.stop();
  },
  /** The harness's project is named after its folder, `p0-1789929422349`,
   *  which no README should carry.  This one is seeded by hand with a
   *  `nexttex.toml` naming it before it is registered, since the name is
   *  read as the project is added, and opened the way the `tab` fixture
   *  opens its own.  Its figure is a real plot rather than the template's
   *  TikZ curve, because a writer's figures are files, and the hover shot
   *  below points at one. */
  tab: async ({ app, home, page }, use) => {
    const root = await seed(app, home, "nonadiabatic-dynamics-review", "Nonadiabatic dynamics review");
    await page.goto(`${app.base}/?token=${app.token}`);
    await page.getByText("Projects", { exact: false }).first().waitFor();
    await openProject(page, root);
    await use(page);
  },
});

/** A project under `~/papers`, from the basic template with the figure
 *  swapped for a PNG, named and registered. */
async function seed(app: Instance, home: string, folder: string, name: string): Promise<string> {
  const root = join(home, "papers", folder);
  cpSync(join(ROOT, "nexttex", "templates", "basic"), root, { recursive: true });
  mkdirSync(join(root, "figures"), { recursive: true });
  writeFileSync(join(root, "figures", "decay-fit.png"), plot(1200, 800));
  const tex = join(root, "main.tex");
  const source = readFileSync(tex, "utf8");
  const from = source.indexOf("  % Drawn here so this document compiles");
  const to = source.indexOf("  \\caption{What the reader should notice");
  if (from < 0 || to < 0) throw new Error("the basic template's figure has moved; re-point the hero spec");
  writeFileSync(tex, source.slice(0, from) + "  \\includegraphics[width=0.6\\linewidth]{figures/decay-fit.png}\n" + source.slice(to));
  writeFileSync(join(root, "nexttex.toml"), `[project]\nname = "${name}"\nbuild_dir = "build"\n`);
  const added = await fetch(`${app.base}/api/projects`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-nexttex-token": app.token },
    body: JSON.stringify({ path: root }),
  });
  if (!added.ok) throw new Error(`could not register the project: ${added.status}`);
  return root;
}

async function stage(tab: Page) {
  await expect(tab.locator(".cm-editor")).toBeVisible({ timeout: 30_000 });
  // A conversation with something in it: an empty transcript makes the
  // agent column look like an empty box rather than the point of the app.
  const composer = tab.locator("textarea");
  await composer.fill("#script:edit\nTighten the abstract's first sentence.");
  await tab.getByRole("button", { name: "Send" }).click();
  await tab.waitForTimeout(2500);
  await expect(tab.locator("canvas").first()).toBeVisible({ timeout: 45_000 });
  await atRest(tab);
}

/** At rest: an edit starts a second build, and a shot taken while it runs
 *  shows "Compiling" and "references pending" on the strip and a dot on
 *  the preview tab, none of which is what the README is showing. */
async function atRest(tab: Page) {
  await expect(tab.getByTestId("status")).toHaveAttribute(
    "data-state", /built|ready/, { timeout: 45_000 },
  );
  await tab.waitForTimeout(1200);
}

/** The app chooses its own theme rather than following the OS, and stamps
 *  it on the root element before React renders, so `emulateMedia` does
 *  nothing here and the light shot once came out dark. */
async function dress(tab: Page, theme: "light" | "dark", width: number, height: number, more: Record<string, string> = {}) {
  await tab.evaluate(({ theme, more }) => {
    window.localStorage.setItem("nexttex.theme", theme);
    for (const [key, value] of Object.entries(more)) window.localStorage.setItem(key, value);
  }, { theme, more });
  await tab.setViewportSize({ width, height });
  await tab.reload();
}

const shot = (name: string) => `../docs/screenshot-${name}.png`;

for (const theme of ["light", "dark"] as const) {
  test(`hero, ${theme}`, async ({ tab }) => {
    await dress(tab, theme, 1680, 1000);
    await stage(tab);
    await tab.screenshot({ path: shot(theme) });
  });
}

/** The editor lit apart from the shell, which is the one thing about this
 *  app that a screenshot explains faster than a sentence: a dark frame
 *  around a white page, because the page is what is being typeset and the
 *  frame is not.  Colouring is switched on here and is off by default --
 *  the README's caption says so -- because the five command families are
 *  the other half of what this picture is for. */
test("a white page in a dark shell", async ({ tab }) => {
  await dress(tab, "dark", 1680, 1000, {
    "nexttex.editor.theme": "white",
    "nexttex.editor.syntax": "colour",
  });
  await stage(tab);
  await tab.screenshot({ path: shot("white-page") });
});

/** Back to the list from inside the project, with a few more projects
 *  registered so the list is a list, and one in each of the two states so
 *  the quiet line under it has something to count. */
async function toProjects(tab: Page, app: Instance, home: string) {
  const more: [string, string, "active" | "archived" | "trashed"][] = [
    ["group-meeting-october", "Group meeting, October", "active"],
    ["fellowship-application", "Fellowship application", "active"],
    ["masters-thesis", "Master's thesis", "archived"],
    ["aims-2023-abstract", "AIMS 2023 abstract", "trashed"],
  ];
  for (const [folder, name, state] of more) {
    if (existsSync(join(home, "papers", folder))) continue;
    await seed(app, home, folder, name);
    if (state === "active") continue;
    const listed = await (await fetch(`${app.base}/api/projects`, { headers: { "x-nexttex-token": app.token } })).json();
    const entry = listed.projects.find((p: { path: string }) => p.path.endsWith(folder));
    await fetch(`${app.base}/api/projects/${entry.id}/state`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-nexttex-token": app.token },
      body: JSON.stringify({ state }),
    });
  }
  await tab.getByTestId("switch-project").click();
  await tab.getByText("Projects", { exact: true }).waitFor();
  await tab.getByTestId("projects-under").waitFor();
  await tab.waitForTimeout(300);
}

for (const theme of ["light", "dark"] as const) {
  test(`the projects screen, ${theme}`, async ({ tab, app, home }) => {
    await dress(tab, theme, 1280, 800);
    await expect(tab.locator(".cm-editor")).toBeVisible({ timeout: 30_000 });
    await toProjects(tab, app, home);
    // One row under the pointer, so its actions show.
    await tab.getByTestId("project-row").first().hover();
    await tab.waitForTimeout(300);
    await tab.screenshot({ path: shot(`projects-${theme}`) });
  });

  test(`the settings sheet, ${theme}`, async ({ tab }) => {
    // At this width the agent column is an overlay, so there is no
    // conversation to stage; the page behind the sheet is enough.
    await dress(tab, theme, 1280, 800);
    await expect(tab.locator(".cm-editor")).toBeVisible({ timeout: 30_000 });
    await expect(tab.locator("canvas").first()).toBeVisible({ timeout: 45_000 });
    await atRest(tab);
    await tab.getByTestId("appearance").click();
    await tab.getByTestId("settings-sheet").waitFor();
    await tab.getByTestId("settings-group-look").click().catch(() => undefined);
    await tab.waitForTimeout(400);
    await tab.screenshot({ path: shot(`settings-${theme}`) });
  });

  /** The column mid-turn: the writer's question, a folded run of tool
   *  calls, the agent's sentence with its diff chip, its plan, and the
   *  permission card the turn stopped at. */
  test(`the Claude column, ${theme}`, async ({ tab }) => {
    // Not staged: the one turn fills the column from its top.
    await dress(tab, theme, 1680, 1000);
    await expect(tab.locator(".cm-editor")).toBeVisible({ timeout: 30_000 });
    await expect(tab.locator("canvas").first()).toBeVisible({ timeout: 45_000 });
    const composer = tab.locator("textarea");
    await composer.click();
    await composer.fill("#script:showcase\nTighten the abstract's first sentence, and add the missing citation in Results.");
    await composer.press("Enter");
    await tab.getByTestId("permission-card").waitFor({ timeout: 20_000 });
    await tab.waitForTimeout(400);
    await tab.getByTestId("chat").screenshot({ path: shot(`agent-${theme}`) });
  });

  /** The two cards that render on hover: the Files drawer's card beside
   *  the figure's row, held by focus, and the table drawn over its source.
   *  The Sections drawer's jump to Results and a scroll bring the figure
   *  line and the table on screen together. */
  test(`the hover cards, ${theme}`, async ({ tab }) => {
    await dress(tab, theme, 1680, 1000);
    await stage(tab);
    await tab.getByTestId("bar-sections").click();
    await tab.getByTestId("section-row").filter({ hasText: "Results" }).first().click();
    await tab.waitForTimeout(300);
    // The jump centres the heading; the figure and the table are further
    // down than the window holds at this width, so the editor is scrolled
    // on until the figure's first line is at the top, which puts the
    // table in the middle.  Before the row takes the focus, since a
    // scroll takes the card away.
    await tab.evaluate(() => {
      const scroller = document.querySelector(".cm-scroller") as HTMLElement;
      const line = [...document.querySelectorAll(".cm-line")].find((el) => el.textContent?.includes("\\begin{figure}"));
      if (!line) return;
      scroller.scrollBy(0, line.getBoundingClientRect().top - scroller.getBoundingClientRect().top - 6);
    });
    await tab.waitForTimeout(300);
    await tab.getByTestId("bar-files").click();
    const folder = tab.locator('[role="tree"] [data-path="figures"]');
    await folder.waitFor();
    if ((await folder.getAttribute("aria-expanded")) !== "true") await folder.click();
    const row = tab.locator('[role="tree"] [data-path="figures/decay-fit.png"]');
    await row.waitFor({ timeout: 10_000 });
    // The pointer parked over the page, where nothing reacts to it, before
    // the row takes the focus: a pointer left over the tree would arm and
    // disarm the card as the drawer redraws under it.
    await tab.mouse.move(1000, 500);
    await row.focus();
    await tab.getByTestId("file-card").locator("img").waitFor({ timeout: 10_000 });
    await hoverCell(tab, "Second & 4.07", "Second", ".nx-table-tooltip");
    await tab.waitForTimeout(300);
    await tab.screenshot({ path: shot(`hover-${theme}`) });
  });

  /** The share sheet over the list, in its shared state, with an invite
   *  made: shared through the route first, the way the row's Share
   *  reaches it. */
  test(`the share sheet, ${theme}`, async ({ tab, app, home }) => {
    await dress(tab, theme, 1280, 800);
    await expect(tab.locator(".cm-editor")).toBeVisible({ timeout: 30_000 });
    const listed = await (await fetch(`${app.base}/api/projects`, { headers: { "x-nexttex-token": app.token } })).json();
    const entry = listed.projects.find((p: { path: string }) => p.path.endsWith("nonadiabatic-dynamics-review"));
    await fetch(`${app.base}/api/projects/${entry.id}/collab/share`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-nexttex-token": app.token },
      body: JSON.stringify({}),
    });
    // A name for the members row, the one the access card's field sets,
    // so the sheet shows a person rather than the nudge to name one.
    await fetch(`${app.base}/api/auth/name`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-nexttex-token": app.token },
      body: JSON.stringify({ display_name: "Ada" }),
    });
    await toProjects(tab, app, home);
    const row = tab.getByTestId("project-row").filter({ hasText: "Nonadiabatic dynamics review" }).first();
    await row.hover();
    await row.getByTestId("row-share").click();
    const sheet = tab.getByTestId("share-panel");
    await sheet.getByTestId("make-invite").click();
    await sheet.getByTestId("invite-text").waitFor();
    await tab.waitForTimeout(400);
    await tab.screenshot({ path: shot(`share-${theme}`) });
  });
}

/** Rest the pointer on the character after `needle` on the line holding
 *  `lineText`, without a click or a key, which would take the focus from
 *  the tree's row and its card with it.  Measured and moved again until
 *  the card is there, as writing.spec.ts does. */
async function hoverCell(tab: Page, lineText: string, needle: string, card: string): Promise<Locator> {
  const measure = () => tab.evaluate(({ lineText, needle }) => {
    const line = [...document.querySelectorAll(".cm-line")].find((el) => el.textContent?.includes(lineText));
    if (!line) return null;
    const target = line.textContent!.indexOf(needle) + 1;
    const walker = document.createTreeWalker(line, NodeFilter.SHOW_TEXT);
    let seen = 0;
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const length = node.textContent!.length;
      if (seen + length > target) {
        const range = document.createRange();
        range.setStart(node, target - seen);
        range.setEnd(node, target - seen + 1);
        const box = range.getBoundingClientRect();
        return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
      }
      seen += length;
    }
    return null;
  }, { lineText, needle });
  for (let tries = 0; tries < 20; tries += 1) {
    const point = await measure();
    if (point) {
      await tab.mouse.move(point.x - 4, point.y);
      await tab.mouse.move(point.x, point.y);
      await tab.mouse.move(point.x + 1, point.y);
      await tab.waitForTimeout(450);
      if (await tab.locator(card).count()) break;
    }
  }
  if (!(await tab.locator(card).count())) {
    await tab.screenshot({ path: process.env.NEXTTEX_HERO_DEBUG ?? "test-results/hover-debug.png" });
    const point = await measure();
    throw new Error(`no ${card} after hovering at ${JSON.stringify(point)}`);
  }
  return tab.locator(card).first();
}
