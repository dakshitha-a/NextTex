import { test as base, expect, openProject } from "../fixtures";
import type { Locator, Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ROOT, startServer, type Instance } from "../server";
import { plot } from "../png";
import { Recorder, glide } from "./recorder";
import { chromePath } from "../browser";

export { expect };

/** What the README's animations share: a temporary home with a server in
 *  it, the paper they are filmed on, and the moves a scene is made of.
 *  The scenes are in `tour-hero.spec.ts`, the hero in both themes, and
 *  `tour.spec.ts`, the tour's rows; both are run by hand, since they write
 *  into `docs/tour/`:
 *
 *      cd e2e && node_modules/.bin/playwright test --config shots.config.ts shots/tour-hero.spec.ts shots/tour.spec.ts
 *
 *  Each scene follows its storyboard on the README's design page: what
 *  happens, and where the camera looks while it does.  The scene only
 *  says "look here" and "pull back"; `animate.py` moves the camera and cuts
 *  the frames. */

/** The options a spec films at: `dpr` times the window's pixels, so a
 *  close-up is cut from real pixels.  Two settings, not one: the page's
 *  ratio, which the context emulates, and the browser's own, given at
 *  launch, because the DevTools screencast sends frames at the
 *  compositor's size and ignores the emulated ratio, so a context at 2
 *  alone still filmed 1440 by 900.  The launch flag is per worker, which is
 *  why the hero, filmed at 3, is a spec file of its own. */
export function filmedAt(dpr: number) {
  return {
    deviceScaleFactor: dpr,
    launchOptions: { executablePath: chromePath(), args: [`--force-device-scale-factor=${dpr}`] },
  };
}

export const OUT = join(ROOT, "docs", "tour");
// Outside test-results/, which Playwright clears as it sees fit.
export const FRAMES = join(tmpdir(), "nexttex-tour-frames");
export const PYTHON = join(ROOT, ".venv", "bin", "python");

export type Scene = { home: string; app: Instance; tab: Page; root: string };

export const ABSTRACT = [
  "  Molecules that absorb light often return to the ground state through a",
  "  conical intersection, a point where two electronic states meet.",
];

export const test = base.extend<Scene>({
  home: async ({}, use) => {
    const home = mkdtempSync(join(tmpdir(), "nexttex-tour-"));
    mkdirSync(join(home, "papers"), { recursive: true });
    const real = join(process.env.HOME ?? "", ".TinyTeX");
    if (process.env.HOME && existsSync(real)) symlinkSync(real, join(home, ".TinyTeX"));
    await use(home);
    rmSync(home, { recursive: true, force: true });
  },
  app: async ({ home }, use) => {
    const pandoc = join(process.env.HOME ?? "", ".local", "bin", "pandoc");
    const instance = await startServer({ HOME: home, ...(existsSync(pandoc) ? { NEXTTEX_PANDOC: pandoc } : {}) });
    await use(instance);
    await instance.stop();
  },
  root: async ({ home }, use) => {
    await use(prepare(home));
  },
  tab: async ({ app, root, page }, use) => {
    await register(app, root);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`${app.base}/?token=${app.token}`);
    await page.getByText("Projects", { exact: false }).first().waitFor();
    await openProject(page, root);
    await use(page);
  },
});


/** The basic template, dressed as a paper somebody is writing: a title,
 *  an author, an abstract, and a real figure. */
export function prepare(home: string): string {
  const root = join(home, "papers", "nonadiabatic-dynamics-review");
  cpSync(join(ROOT, "nexttex", "templates", "basic"), root, { recursive: true });
  mkdirSync(join(root, "figures"), { recursive: true });
  writeFileSync(join(root, "figures", "decay-fit.png"), plot(1200, 800));
  const tex = join(root, "main.tex");
  let source = readFileSync(tex, "utf8");
  const from = source.indexOf("  % Drawn here so this document compiles");
  const to = source.indexOf("  \\caption{What the reader should notice");
  source = source.slice(0, from) + "  \\includegraphics[width=0.6\\linewidth]{figures/decay-fit.png}\n" + source.slice(to);
  source = source
    .replace("\\title{A Working Title}", "\\title{Nonadiabatic Dynamics Near Conical Intersections}")
    .replace("\\author{Your Name}", "\\author{Ada Okafor}")
    .replace(
      "  One paragraph saying what the work is, what you did, and what you found.\n  Write it last.",
      ABSTRACT.join("\n"),
    );
  writeFileSync(tex, source);
  writeFileSync(join(root, "nexttex.toml"), `[project]\nname = "Nonadiabatic dynamics review"\nbuild_dir = "build"\n`);
  return root;
}

export async function register(app: Instance, root: string): Promise<string> {
  const added = await fetch(`${app.base}/api/projects`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-nexttex-token": app.token },
    body: JSON.stringify({ path: root }),
  });
  if (!added.ok) throw new Error(`could not register the project: ${added.status}`);
  return (await added.json()).id ?? "";
}

export async function dress(tab: Page, theme: "light" | "dark") {
  await tab.evaluate((theme) => window.localStorage.setItem("nexttex.theme", theme), theme);
  await tab.reload();
  await Recorder.install(tab);
  await expect(tab.locator(".cm-editor")).toBeVisible({ timeout: 30_000 });
  await expect(tab.locator("canvas").first()).toBeVisible({ timeout: 60_000 });
}

/** The tour animations are about one thing each, so the agent column folds away
 *  and the source and the page get the width. */
export async function withoutAgent(tab: Page) {
  if (await tab.getByTestId("chat").isVisible().catch(() => false)) {
    await tab.keyboard.press("Control+Alt+a");
    await expect(tab.getByTestId("chat")).toBeHidden({ timeout: 5000 });
  }
}

export async function atRest(tab: Page) {
  await expect.poll(async () => tab.getByTestId("status").getAttribute("data-state"), { timeout: 60_000 })
    .toMatch(/built|ready/);
  await tab.waitForTimeout(800);
}

/** The editor line holding `text`. */
export function line(tab: Page, text: string): Locator {
  return tab.locator(".cm-line").filter({ hasText: text }).first();
}

/** A rectangle spanning several elements, for a camera that should hold
 *  a paragraph rather than one line of it. */
export async function span(...targets: Locator[]) {
  const boxes = (await Promise.all(targets.map((t) => t.boundingBox()))).filter(Boolean) as
    { x: number; y: number; width: number; height: number }[];
  const x = Math.min(...boxes.map((b) => b.x));
  const y = Math.min(...boxes.map((b) => b.y));
  const right = Math.max(...boxes.map((b) => b.x + b.width));
  const bottom = Math.max(...boxes.map((b) => b.y + b.height));
  return { x, y, width: right - x, height: bottom - y };
}

/** The text layer's span on the page holding `word`. */
export function onPage(tab: Page, word: string): Locator {
  return tab.locator(".nx-text-layer span").filter({ hasText: word }).first();
}

/** CodeMirror draws only the lines near the screen, so a line further
 *  down is not in the page until the editor is scrolled to it: scrolled
 *  from the top in steps until it appears, then brought to the middle. */
export async function reveal(tab: Page, text: string): Promise<Locator> {
  const target = line(tab, text);
  if (!(await target.count())) {
    await tab.evaluate(() => { (document.querySelector(".cm-scroller") as HTMLElement).scrollTop = 0; });
    for (let i = 0; i < 40 && !(await target.count()); i += 1) {
      await tab.evaluate(() => { (document.querySelector(".cm-scroller") as HTMLElement).scrollBy(0, 300); });
      await tab.waitForTimeout(60);
    }
  }
  await target.evaluate((el) => el.scrollIntoView({ block: "center" }));
  await tab.waitForTimeout(150);
  return target;
}

export async function caretToEndOf(tab: Page, text: string) {
  const target = await reveal(tab, text);
  await glide(tab, target);
  await target.click();
  await tab.keyboard.press("End");
}

/** The hero is shown at the README's full width and a tour animation in
 *  half of a table, so the hero is cut at 1280 pixels and the rest at
 *  960, both at 25 frames a second, which is still about twice what the
 *  README draws them at on a fine screen. */
export function animate(scene: string, out: string, extra: string[] = ["--width", "960"]) {
  mkdirSync(OUT, { recursive: true });
  const printed = execFileSync(PYTHON, [join(ROOT, "e2e", "shots", "animate.py"), join(FRAMES, scene), join(OUT, out), ...extra], { encoding: "utf8" });
  console.log(printed.trim());
}
