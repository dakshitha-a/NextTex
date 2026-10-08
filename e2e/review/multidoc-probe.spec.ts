import { test, expect, openProject } from "../fixtures";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Page } from "@playwright/test";

/** The build flash and the double-click in a project of several documents.
 *
 *  Two documents, main.tex and si.tex, read a shared chapter, and main
 *  alone reads a second. Each case drives one path across files and
 *  preview tabs and says what happened. A click on the preview tab in
 *  front folds the pane, by design, so a case never clicks the tab that
 *  is already in front. Not a check: run it with
 *    npx playwright test --config review/review.config.ts multidoc-probe
 */

const MAIN = String.raw`\documentclass{article}
\begin{document}
\section{Main}
The main document opens with its own paragraph about the thesis.

\input{chapters/one}

\input{chapters/shared}
\end{document}
`;
const SI = String.raw`\documentclass{article}
\begin{document}
\section{Supporting}
The supporting document opens with its own paragraph about the appendix.

\input{chapters/shared}
\end{document}
`;
const ONE = String.raw`The first chapter belongs to the thesis alone, and its model of the noise is the
alpha model, which the chapter describes before anything else is said about it.
`;
const SHARED = String.raw`The shared chapter is read by both documents, and its model of the drift is the
omega model, which both documents describe in the same words.
`;

async function watchFlashes(page: Page) {
  await page.addInitScript(() => {
    const seen: { page: number; doc: string; top: number; height: number }[] = [];
    (window as unknown as { flashes: typeof seen }).flashes = seen;
    new MutationObserver((records) => {
      for (const record of records) {
        for (const node of record.addedNodes) {
          if (!(node instanceof HTMLElement) || !node.classList.contains("nx-flash")) continue;
          const pages = [...document.querySelectorAll(".nx-page")].filter((p) => (p as HTMLElement).offsetParent !== null);
          const current = document.querySelector('[data-testid^="preview-tab-"][aria-current="true"]');
          seen.push({
            page: pages.indexOf(node.closest(".nx-page") as Element),
            visible: (node.closest(".nx-page") as HTMLElement | null)?.offsetParent !== null,
            doc: current?.getAttribute("data-testid")?.replace("preview-tab-", "") ?? "?",
            top: parseFloat(node.style.top),
            height: parseFloat(node.style.height),
          });
        }
      }
    }).observe(document, { childList: true, subtree: true });
  });
}

async function setUp(app: any, project: any, page: Page, both: boolean) {
  mkdirSync(join(project.root, "chapters"), { recursive: true });
  writeFileSync(join(project.root, "main.tex"), MAIN);
  writeFileSync(join(project.root, "si.tex"), SI);
  writeFileSync(join(project.root, "chapters", "one.tex"), ONE);
  writeFileSync(join(project.root, "chapters", "shared.tex"), SHARED);
  await watchFlashes(page);
  await page.goto(`${app.base}/?token=${app.token}`);
  await page.getByText("Projects", { exact: false }).first().waitFor();
  await openProject(page, project.root);
  await expect(page.locator(".nx-text-layer span", { hasText: "thesis" }).first()).toBeAttached({ timeout: 60_000 });
  if (both) {
    await page.getByTestId("add-preview").click();
    await page.getByRole("menuitem", { name: "si.tex" }).click();
    await expect(page.getByTestId("preview-tab-si.tex")).toHaveAttribute("aria-current", "true");
    await expect(page.locator(".nx-text-layer span", { hasText: "appendix" }).first()).toBeAttached({ timeout: 60_000 });
  }
}

async function openFile(page: Page, path: string) {
  const parts = path.split("/");
  if (parts.length > 1) {
    const folder = page.locator(`[role="tree"] [data-path="${parts[0]}"]`);
    if (!(await page.locator(`[role="tree"] [data-path="${path}"]`).count())) await folder.click();
  }
  await page.locator(`[role="tree"] [data-path="${path}"]`).click();
  await expect(page.locator(`[data-tab][data-path="${path}"] button[aria-current="true"]`)).toBeVisible({ timeout: 15_000 });
}

/** Type a word after `after` on the line holding it, and wait for a flash. */
async function typeAfter(page: Page, after: string, word: string) {
  const line = page.locator(".cm-line", { hasText: after }).first();
  await line.click();
  await page.keyboard.press("Home");
  const text = (await line.textContent()) ?? "";
  for (let i = 0; i < text.indexOf(after) + after.length; i += 1) await page.keyboard.press("ArrowRight");
  await page.evaluate(() => { (window as any).flashes.length = 0; });
  await page.keyboard.type(` ${word}`);
}

async function flashReport(page: Page, word: string) {
  await expect.poll(async () => page.evaluate(() => (window as any).flashes.length), { timeout: 45_000 })
    .toBeGreaterThan(0).catch(() => undefined);
  await page.waitForTimeout(1500);
  return page.evaluate((word) => {
    const flashes = (window as any).flashes as { page: number; doc: string; top: number; height: number }[];
    const pages = ([...document.querySelectorAll(".nx-page")] as HTMLElement[]).filter((p) => p.offsetParent !== null);
    const current = document.querySelector('[data-testid^="preview-tab-"][aria-current="true"]')?.getAttribute("data-testid");
    return {
      preview: current,
      flashes: flashes.map((f) => {
        const on = pages[f.page];
        const span = on && [...on.querySelectorAll(".nx-text-layer span")].find((s) => !s.querySelector("span") && (s.textContent ?? "").includes(word));
        if (!on || !span) return { ...f, covers: false };
        const box = on.getBoundingClientRect();
        const rect = span.getBoundingClientRect();
        const middle = rect.top + rect.height / 2 - box.top - on.clientTop;
        return { ...f, covers: middle >= f.top && middle <= f.top + f.height };
      }),
    };
  }, word);
}

async function dblclickWord(page: Page, word: string, nth = 0) {
  const span = page.locator(".nx-text-layer span", { hasText: word }).nth(nth);
  await expect(span).toBeAttached({ timeout: 60_000 });
  await span.scrollIntoViewIfNeeded();
  const at = await span.evaluate((el: Element, wanted: string) => {
    const node = el.firstChild!;
    const index = (el.textContent ?? "").indexOf(wanted);
    const range = document.createRange();
    range.setStart(node, index);
    range.setEnd(node, index + wanted.length);
    const box = range.getBoundingClientRect();
    return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  }, word);
  await page.mouse.dblclick(at.x, at.y);
  await page.waitForTimeout(1500);
  const tab = await page.locator('[data-tab] button[aria-current="true"]').first().textContent();
  const selected = await page.evaluate(() => window.getSelection()?.toString() ?? "");
  const line = await page.evaluate(() => document.querySelector(".cm-activeLine")?.textContent ?? "");
  return { tab, selected, line };
}

const report = (name: string, value: unknown) => console.log(`PROBE ${name}: ${JSON.stringify(value)}`);

test("A: typing in a chapter only main reads flashes main's page", async ({ app, project, page }) => {
  await setUp(app, project, page, false);
  await openFile(page, "chapters/one.tex");
  await typeAfter(page, "alpha", "zebra");
  report("A", await flashReport(page, "zebra"));
});

test("B: typing in the shared chapter with main in front flashes main", async ({ app, project, page }) => {
  await setUp(app, project, page, true);
  await page.getByTestId("preview-tab-main.tex").click();
  await openFile(page, "chapters/shared.tex");
  await typeAfter(page, "omega", "yak");
  report("B", await flashReport(page, "yak"));
});

test("C: typing in the shared chapter with si in front flashes si", async ({ app, project, page }) => {
  await setUp(app, project, page, true);
  await openFile(page, "chapters/shared.tex");
  await typeAfter(page, "omega", "xerus");
  report("C", await flashReport(page, "xerus"));
});

test("D: typing in main's chapter while si is in front", async ({ app, project, page }) => {
  await setUp(app, project, page, true);
  await openFile(page, "chapters/one.tex");
  await typeAfter(page, "alpha", "walrus");
  report("D", await flashReport(page, "walrus"));
});

test("E: a double-click on si's page in the shared chapter opens the chapter", async ({ app, project, page }) => {
  await setUp(app, project, page, true);
  await openFile(page, "si.tex");
  report("E", await dblclickWord(page, "omega"));
});

test("F: a double-click on si's own paragraph opens si.tex", async ({ app, project, page }) => {
  await setUp(app, project, page, true);
  await openFile(page, "chapters/shared.tex");
  report("F", await dblclickWord(page, "appendix"));
});

test("G: a double-click on main's page in main's chapter while si.tex is open", async ({ app, project, page }) => {
  await setUp(app, project, page, true);
  await page.getByTestId("preview-tab-main.tex").click();
  await openFile(page, "si.tex");
  await page.getByTestId("preview-tab-main.tex").click();
  report("G", await dblclickWord(page, "alpha"));
});

test("H: the same word in two chapters, double-clicked in the second", async ({ app, project, page }) => {
  await setUp(app, project, page, false);
  // "model" is in one.tex twice and shared.tex twice; the third on the
  // page is shared's first.
  report("H", await dblclickWord(page, "model", 2));
});

test("I: after switching preview tabs back and forth, a double-click on main", async ({ app, project, page }) => {
  await setUp(app, project, page, true);
  await page.getByTestId("preview-tab-main.tex").click();
  await page.getByTestId("preview-tab-si.tex").click();
  await page.getByTestId("preview-tab-main.tex").click();
  await page.waitForTimeout(1500);
  report("I", await dblclickWord(page, "thesis"));
});

test("J: an outside write to main's chapter while typing in shared with si in front", async ({ app, project, page }) => {
  await setUp(app, project, page, true);
  await openFile(page, "chapters/shared.tex");
  writeFileSync(join(project.root, "chapters", "one.tex"), ONE.replace("alpha", "alpha outside"));
  await typeAfter(page, "omega", "quokka");
  report("J", await flashReport(page, "quokka"));
});

test("K: typing in the shared chapter with si in front, then main brought forward", async ({ app, project, page }) => {
  await setUp(app, project, page, true);
  await openFile(page, "chapters/shared.tex");
  await typeAfter(page, "omega", "kudu");
  await page.getByTestId("preview-tab-main.tex").click();
  await page.waitForTimeout(500);
  await openFile(page, "chapters/shared.tex");
  await expect(page.getByTestId("preview-tab-main.tex")).toHaveAttribute("aria-current", "true");
  await page.evaluate(() => { (window as any).flashes.length = 0; });
  await typeAfter(page, "kudu", "lemur");
  report("K", await flashReport(page, "lemur"));
});

test("L: a double-click on si right after a build of main", async ({ app, project, page }) => {
  await setUp(app, project, page, true);
  await page.getByTestId("preview-tab-main.tex").click();
  await openFile(page, "chapters/one.tex");
  await typeAfter(page, "alpha", "marmot");
  await page.waitForTimeout(2500);
  await page.getByTestId("preview-tab-si.tex").click();
  await page.waitForTimeout(1000);
  report("L", await dblclickWord(page, "appendix"));
});

test("M: two chapters of one name in two folders", async ({ app, project, page }) => {
  mkdirSync(join(project.root, "part1"), { recursive: true });
  mkdirSync(join(project.root, "part2"), { recursive: true });
  writeFileSync(join(project.root, "main.tex"), String.raw`\documentclass{article}
\begin{document}
\input{part1/intro}

\input{part2/intro}
\end{document}
`);
  writeFileSync(join(project.root, "part1", "intro.tex"), "The first introduction speaks of the ibex and its mountain.\n");
  writeFileSync(join(project.root, "part2", "intro.tex"), "The second introduction speaks of the jackal and its desert.\n");
  await watchFlashes(page);
  await page.goto(`${app.base}/?token=${app.token}`);
  await page.getByText("Projects", { exact: false }).first().waitFor();
  await openProject(page, project.root);
  await expect(page.locator(".nx-text-layer span", { hasText: "jackal" }).first()).toBeAttached({ timeout: 60_000 });
  const click = await dblclickWord(page, "jackal");
  const path = await page.locator('[data-tab] button[aria-current="true"]').first().evaluate((b) => b.closest("[data-tab]")?.getAttribute("data-path"));
  report("M-click", { ...click, path });
  await page.locator(".cm-line", { hasText: "jackal" }).first().click();
  await page.keyboard.press("End");
  await page.evaluate(() => { (window as any).flashes.length = 0; });
  await page.keyboard.type(" Narwhal.");
  report("M-flash", await flashReport(page, "Narwhal"));
});

test("N: a long document, typing on its third page", async ({ app, project, page }) => {
  const filler = Array.from({ length: 60 }, (_, i) => `Paragraph ${i} of the filler, which is long enough to take a few lines of type on the page.`).join("\n\n");
  mkdirSync(join(project.root, "chapters"), { recursive: true });
  writeFileSync(join(project.root, "main.tex"), String.raw`\documentclass{article}
\begin{document}
\input{chapters/long}
\end{document}
`);
  writeFileSync(join(project.root, "chapters", "long.tex"), filler + "\n\nThe closing paragraph names the okapi.\n");
  await watchFlashes(page);
  await page.goto(`${app.base}/?token=${app.token}`);
  await page.getByText("Projects", { exact: false }).first().waitFor();
  await openProject(page, project.root);
  await expect(page.locator(".nx-page").nth(1)).toBeAttached({ timeout: 60_000 });
  await openFile(page, "chapters/long.tex");
  await page.locator(".cm-content").click();
  await page.keyboard.press("Control+End");
  await page.keyboard.press("ArrowUp");
  await page.keyboard.press("End");
  await page.evaluate(() => { (window as any).flashes.length = 0; });
  await page.keyboard.type(" Pangolin.");
  const flashed = await flashReport(page, "Pangolin");
  report("N", flashed);
});
