import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { openProject } from "../fixtures";
import { Recorder, glide } from "./recorder";
import {
  FRAMES, animate, atRest, caretToEndOf, dress, expect, filmedAt, line, onPage, prepare, register,
  reveal, span, test, withoutAgent,
} from "./tour-kit";

/** The README's tour, a row per scene, filmed in the real app at twice the
 *  window's pixels; the hero is `tour-hero.spec.ts`, and what both share
 *  is `tour-kit.ts`.  Run by hand, since it writes into `docs/tour/`:
 *
 *      cd e2e && node_modules/.bin/playwright test --config shots.config.ts shots/tour.spec.ts
 *
 *  Nothing reaches the network.  The reference search is answered by a
 *  route in the page, the way `papers.spec.ts` answers it, and the
 *  co-author in "Write together" is a second window on the same install
 *  with a name of its own, because the browser tier's servers share
 *  projects over an in-process transport that two installs cannot use.
 *  What the first window shows, a named cursor arriving and typing, is
 *  what a co-author on another install looks like. */

test.use(filmedAt(Number(process.env.NEXTTEX_SHOT_DPR ?? 2)));

// --- B: errors in plain English ---------------------------------------------

test("B, errors in plain English", async ({ tab }) => {
  await dress(tab, "dark");
  await withoutAgent(tab);
  await atRest(tab);
  await tab.mouse.move(700, 450);

  const rec = new Recorder(tab, "errors", FRAMES);
  await rec.start();
  await rec.hold(700);

  // The closing dollar of $\Delta E$, deleted.
  const maths = line(tab, "the energy gap");
  await caretToEndOf(tab, "the energy gap");
  await rec.focus(maths, { pad: 80 });
  await rec.hold(500);
  for (let i = 0; i < " between two states.".length; i += 1) await tab.keyboard.press("ArrowLeft");
  await rec.hold(300);
  await tab.keyboard.press("Backspace");
  await rec.hold(500);

  const status = tab.getByTestId("status");
  await rec.quickly(() => expect(status).toHaveAttribute("data-state", "errors", { timeout: 45_000 }));
  await rec.focus(status, { pad: 60 });
  await rec.hold(1300);

  await glide(tab, status);
  await status.click();
  const drawer = tab.getByTestId("diagnostics");
  await drawer.waitFor();
  const row = drawer.getByRole("button").filter({ hasText: /Missing \$|maths/i }).first();
  await rec.hold(500);
  await glide(tab, row);
  await row.click();
  await expect(drawer.getByText(/maths mode/i).first()).toBeVisible({ timeout: 10_000 });
  await rec.focus(await span(drawer.getByText(/maths mode/i).first(), row), { pad: 50 });
  await rec.hold(2800);

  // The fix: the dollar goes back, and the error leaves.
  rec.wide();
  await tab.locator(".cm-content").focus();
  await tab.keyboard.press("Control+z");
  await rec.quickly(() => expect(status).toHaveAttribute("data-state", /built|ready/, { timeout: 45_000 }));
  await rec.focus(status, { pad: 60 });
  await rec.hold(1500);
  rec.wide();
  await rec.hold(900);
  await rec.stop();
  animate("errors", "errors.webp");
});

// --- C: every pause is a version, and git -----------------------------------

const gitEnv = {
  ...process.env,
  GIT_AUTHOR_NAME: "Ada Okafor", GIT_AUTHOR_EMAIL: "ada@example.org",
  GIT_COMMITTER_NAME: "Ada Okafor", GIT_COMMITTER_EMAIL: "ada@example.org",
};

test("C, history and git", async ({ app, home, page }) => {
    // A repository with the paper committed, and one sentence written
    // since, so the Git drawer has something to show.
    const root = prepare(home);
    const git = (...args: string[]) => execFileSync("git", args, { cwd: root, env: gitEnv });
    writeFileSync(join(root, ".gitignore"), "build/\n.nexttex/\n");
    git("init", "-q", "-b", "main");
    git("add", "-A");
    git("commit", "-q", "-m", "First draft");
    const tex = join(root, "main.tex");
    writeFileSync(tex, readFileSync(tex, "utf8").replace(
      "Start here.  A sentence",
      "Ultrafast spectroscopy now resolves these crossings directly.\n\nStart here.  A sentence",
    ));
    await register(app, root);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`${app.base}/?token=${app.token}`);
    await page.getByText("Projects", { exact: false }).first().waitFor();
    await openProject(page, root);
    const tab = page;
    await dress(tab, "dark");
    await withoutAgent(tab);
    await atRest(tab);
    // A repository with no remote opens the Git drawer on the offer to back
    // it up to GitHub; that is its own story, so it is put away first.
    await tab.getByTestId("bar-git").click();
    await tab.getByRole("button", { name: "Not now" }).click();
    await tab.getByTestId("bar-files").click();
    await tab.mouse.move(700, 450);

    const rec = new Recorder(tab, "history-git", FRAMES);
    await rec.start();
    await rec.hold(700);

    // A paragraph, gone.
    const first = line(tab, "Start here.");
    await glide(tab, first);
    // At its top left: the middle of a line that wraps is its second row.
    await first.click({ position: { x: 3, y: 5 } });
    await tab.keyboard.press("Home");
    await rec.focus(await span(first, line(tab, "Section~\\ref{sec:results}")), { pad: 70 });
    await rec.hold(500);
    // The paragraph's last line, shift-clicked: arrow keys walk the soft
    // wrapped screen lines, which would leave half of it behind.
    const last = line(tab, "Section~\\ref{sec:results}");
    await glide(tab, last);
    await tab.keyboard.down("Shift");
    await last.click();
    await tab.keyboard.press("End");
    await tab.keyboard.up("Shift");
    await rec.hold(600);
    await tab.keyboard.press("Backspace");
    await rec.hold(1200);

    // History has the version from before it.
    rec.wide();
    await glide(tab, tab.getByTestId("bar-history"));
    await expect.poll(async () => {
      if ((await tab.getByTestId("drawer").getAttribute("data-drawer")) !== "history") {
        await tab.getByTestId("bar-history").click();
      }
      return tab.getByTestId("version").count();
    }, { timeout: 20_000 }).toBeGreaterThan(1);
    const before = tab.getByTestId("version").last();
    await rec.focus(await span(tab.getByTestId("history-header"), before), { pad: 30 });
    await rec.hold(800);
    await glide(tab, before);
    await before.click();
    await rec.hold(900);
    const restoreThis = tab.getByRole("button", { name: "Restore this" });
    await glide(tab, restoreThis);
    await restoreThis.click();
    const restore = tab.getByRole("button", { name: "Restore", exact: true });
    await glide(tab, restore);
    await restore.click();
    // On disk, not only on screen: the viewer shows an old version's text
    // whether or not it was restored.
    await rec.quickly(() => expect.poll(() => readFileSync(tex, "utf8"), { timeout: 15_000 }).toContain("this~\\cite{knuth1984}, and"));
    await expect(tab.getByTestId("viewing-banner")).toHaveCount(0, { timeout: 10_000 });
    await reveal(tab, "Start here.");
    await rec.focus(await span(line(tab, "Start here."), await reveal(tab, "Section~\\ref{sec:results}")), { pad: 70 });
    await rec.hold(1200);
    rec.wide();
    await rec.hold(1300);

    // And git, when you want it: the change, its patch, a commit.
    await glide(tab, tab.getByTestId("bar-git"));
    await tab.getByTestId("bar-git").click();
    await expect(tab.getByTestId("drawer")).toHaveAttribute("data-drawer", "git");
    const changed = tab.getByText(/file(s)? changed/).first();
    if (await changed.isVisible().catch(() => false)) await changed.click();
    const change = tab.getByTestId("git-change").filter({ hasText: "main.tex" }).first();
    await change.waitFor({ timeout: 15_000 });
    await rec.focus(tab.getByTestId("drawer"), { pad: 10 });
    await rec.hold(600);
    await glide(tab, change.getByTestId("git-change-toggle"));
    await change.getByTestId("git-change-toggle").click();
    await tab.getByTestId("git-patch").first().waitFor();
    await rec.focus(await span(change, tab.getByTestId("git-patch").first()), { pad: 40 });
    await rec.hold(1800);
    const message = tab.getByPlaceholder("What changed");
    rec.wide();
    await glide(tab, message);
    await message.click();
    await message.pressSequentially("Open the introduction with the spectroscopy", { delay: 40 });
    await rec.hold(300);
    await message.press("Enter");
    await expect(tab.getByTestId("git-history").getByTestId("git-commit")).toHaveCount(2, { timeout: 15_000 });
    await rec.focus(tab.getByTestId("git-history"), { pad: 40 });
    await rec.hold(1800);
    rec.wide();
    await rec.hold(900);
    await rec.stop();
  animate("history-git", "history-git.webp");
});

// --- D: citations it cannot invent ------------------------------------------

const TULLY = {
  doi: "10.1063/1.459170",
  title: "Molecular dynamics with electronic transitions",
  first: "Tully", authors: 1, year: "1990", journal: "The Journal of Chemical Physics",
  names: ["John C. Tully"],
  abstract: "A method is proposed for carrying out molecular dynamics simulations of processes that involve electronic transitions.",
};

test("D, citations it cannot invent", async ({ tab, root }) => {
  await dress(tab, "dark");
  await withoutAgent(tab);
  await atRest(tab);
  // The publisher's answers, as the server would relay them, without the
  // network: the search, and the add, which also writes the entry the
  // real route would have written, so the completion list can offer it.
  await tab.route("**/library/search?*", (route) => route.fulfill({
    status: 200, contentType: "application/json",
    body: JSON.stringify({ source: "crossref", results: [
      TULLY,
      { doi: "10.1063/1.1471245", title: "Nonadiabatic dynamics near conical intersections", first: "Worth", authors: 2, year: "2002", journal: "The Journal of Chemical Physics", names: ["Graham A. Worth", "Lorenz S. Cederbaum"], abstract: "" },
      { doi: "10.1146/annurev.physchem.55.091602.094335", title: "Beyond the Born-Oppenheimer approximation", first: "Worth", authors: 2, year: "2004", journal: "Annual Review of Physical Chemistry", names: ["Graham A. Worth", "Lorenz S. Cederbaum"], abstract: "" },
    ] }),
  }));
  await tab.route("**/library/add", async (route) => {
    const bib = join(root, "references.bib");
    writeFileSync(bib, readFileSync(bib, "utf8") + `
@article{Tully1990molecular,
  author  = {Tully, John C.},
  title   = {Molecular dynamics with electronic transitions},
  journal = {The Journal of Chemical Physics},
  volume  = {93},
  number  = {2},
  pages   = {1061--1069},
  year    = {1990},
  doi     = {10.1063/1.459170},
}
`);
    await route.fulfill({ status: 200, contentType: "application/json",
      body: JSON.stringify({ added: true, key: "Tully1990molecular", title: TULLY.title, author: "Tully", year: "1990" }) });
  });
  await tab.mouse.move(700, 450);

  const rec = new Recorder(tab, "citations", FRAMES);
  await rec.start();
  await rec.hold(600);

  await glide(tab, tab.getByTestId("bar-papers"));
  await tab.getByTestId("bar-papers").click();
  const panel = tab.getByTestId("papers-panel");
  const search = panel.getByTestId("papers-search");
  await search.waitFor();
  await rec.focus(panel, { pad: 10 });
  await glide(tab, search);
  await search.click();
  await search.pressSequentially("surface hopping electronic transitions", { delay: 45 });
  await search.press("Enter");
  const result = panel.getByTestId("papers-result").first();
  await result.waitFor();
  await rec.hold(1300);
  const add = result.getByTestId("papers-result-add");
  await glide(tab, add);
  await add.click();
  await expect(result.getByTestId("papers-result-added")).toContainText("Tully1990molecular");
  await rec.focus(result, { pad: 30 });
  await rec.hold(1600);

  // Into the text: \cite{ offers the key that just arrived.
  rec.wide();
  await caretToEndOf(tab, "conical intersection, a point");
  await tab.keyboard.press("ArrowLeft");
  await rec.focus(await span(line(tab, "Molecules that absorb"), line(tab, "conical intersection, a point")), { pad: 110 });
  // The completion list reads the keys a build found, so the tilde goes
  // in first and its build, which reads the new entry, lands before the
  // \cite{ that wants it.
  await tab.keyboard.type("~", { delay: 90 });
  await rec.quickly(async () => {
    await expect(tab.getByTestId("status")).toHaveAttribute("data-state", /compiling|stale/, { timeout: 15_000 }).catch(() => undefined);
    await expect(tab.getByTestId("status")).toHaveAttribute("data-state", /built|ready/, { timeout: 45_000 });
    await tab.waitForTimeout(800);
  });
  await tab.keyboard.type("\\cite{Tul", { delay: 90 });
  const list = tab.locator(".cm-tooltip-autocomplete");
  await rec.quickly(() => expect(list).toContainText("Tully1990molecular", { timeout: 10_000 }), 3);
  await rec.hold(1200);
  await tab.keyboard.press("Enter");
  await rec.hold(1500);
  rec.wide();
  await rec.hold(900);
  await rec.stop();
  animate("citations", "citations.webp");
});

// --- F: download as Word ----------------------------------------------------

test("F, download as Word", async ({ tab, home }) => {
  await dress(tab, "dark");
  await withoutAgent(tab);
  await atRest(tab);
  await tab.mouse.move(700, 450);

  const rec = new Recorder(tab, "download", FRAMES);
  await rec.start();
  await rec.hold(600);

  await glide(tab, tab.getByTestId("bar-download"));
  await tab.getByTestId("bar-download").click();
  const panel = tab.getByTestId("download-panel");
  const row = panel.locator('[data-testid="download-row"][data-document="main.tex"]');
  await rec.quickly(() => expect(row).toHaveAttribute("data-built", "true", { timeout: 60_000 }));
  await rec.focus(row, { pad: 70 });
  await rec.hold(1200);
  const word = row.getByTestId("download-export").first();
  await glide(tab, word);
  const waiting = tab.waitForEvent("download");
  await word.click();
  const download = await rec.quickly(() => waiting);
  const docx = join(home, "main.docx");
  await download.saveAs(docx);
  await rec.hold(1200);

  // What arrived: the Word file, its citations and its figure in place,
  // drawn from the document itself through pandoc.
  const pandoc = join(process.env.HOME ?? "", ".local", "bin", "pandoc");
  const html = execFileSync(pandoc, [docx, "-t", "html", "--embed-resources", "--standalone"], { cwd: home, encoding: "utf8" });
  const body = html.slice(html.indexOf("<body>") + 6, html.lastIndexOf("</body>"));
  rec.wide(0.01);
  await tab.setContent(`<!doctype html><html><head><style>
    body{margin:0;background:#2b2f33;font:15px/1.5 Cambria,Georgia,serif;color:#111}
    .bar{background:#185abd;color:#fff;font:600 13px system-ui,sans-serif;padding:9px 18px}
    .page{width:760px;margin:26px auto;background:#fff;padding:64px 80px;box-shadow:0 2px 12px rgba(0,0,0,.4);min-height:900px}
    img{max-width:60%;display:block;margin:12px auto} h1{font-size:22px;text-align:center} h2{font-size:17px}
  </style></head><body><div class="bar">main.docx</div><div class="page">${body}</div></body></html>`);
  await Recorder.install(tab);
  await rec.hold(800);
  await rec.focus({ x: 340, y: 40, width: 760, height: 420 }, { pad: 0, ease: 0.9 });
  await rec.hold(2400);
  rec.wide();
  await rec.hold(900);
  await rec.stop();
  animate("download", "download.webp");
});

// --- E: write together ------------------------------------------------------

test("E, write together", async ({ tab, app, root, browser }) => {
  await fetch(`${app.base}/api/auth/name`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-nexttex-token": app.token },
    body: JSON.stringify({ display_name: "Ada" }),
  });
  await dress(tab, "dark");
  await withoutAgent(tab);
  await atRest(tab);

  // The co-author: a second window, under a name of its own.
  const other = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await other.route("**/api/auth", async (route) => {
    const response = await route.fetch();
    const json = await response.json();
    await route.fulfill({ response, json: { ...json, displayName: "Kenji" } });
  });
  await other.goto(`${app.base}/?token=${app.token}`);
  await other.getByText("Projects", { exact: false }).first().waitFor();
  await openProject(other, root);
  await expect(other.locator(".cm-content")).toContainText("documentclass", { timeout: 20_000 });

  await tab.mouse.move(700, 450);
  const rec = new Recorder(tab, "together", FRAMES);
  await rec.start();
  await rec.hold(900);

  // Kenji arrives at the end of the maths paragraph and writes.
  const target = await reveal(other, "the minus signs");
  await target.click();
  await other.keyboard.press("End");
  const caret = tab.locator(".cm-ySelectionCaret").first();
  await reveal(tab, "Inline maths sits");
  await rec.focus(await span(line(tab, "Inline maths sits"), line(tab, "the minus signs")), { pad: 100 });
  const typing = other.keyboard.type(" At the crossing the gap closes, and the populations swap.", { delay: 70 });
  await expect(caret).toBeVisible({ timeout: 15_000 });
  await typing;
  await rec.hold(600);

  // Meanwhile Ada writes in the next paragraph, and nothing collides.
  await caretToEndOf(tab, "Section~\\ref{sec:results}");
  await tab.keyboard.type(" Two states, one point.", { delay: 70 });
  await rec.hold(800);
  await other.keyboard.press("ArrowUp");
  await rec.hold(1600);

  rec.wide();
  await rec.quickly(() => expect.poll(async () => onPage(tab, "populations").count(), { timeout: 30_000 }).toBeGreaterThan(0));
  await rec.focus(await span(onPage(tab, "one point"), onPage(tab, "populations")), { pad: 80 });
  await rec.hold(2000);
  rec.wide();
  await rec.hold(900);
  await rec.stop();
  await other.close();
  animate("together", "together.webp");
});
