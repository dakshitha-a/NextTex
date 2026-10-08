import { test, expect, openProject } from "../fixtures";
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Page } from "@playwright/test";

/** Mod-Enter shows the caret's place on the page as one line of type.
 *
 *  The writer saw a box drawn around a whole paragraph (8 October 2026).
 *  SyncTeX answers a caption's line with one box around the float, and a
 *  two-column class's line with the column's box beside the lines of
 *  type; either was flashed whole. Each case presses the key with the
 *  caret in a word and asks that every flash covers the word and is no
 *  taller than a line of it. The specs before this one asked only that a
 *  flash appeared, which a box around the paragraph did.
 */

const MAIN = String.raw`\documentclass{article}
\begin{document}
\section{Main}
The main document opens with its own paragraph about the thesis, at a length that makes the page set it over several lines of type, so that the giraffe near its end is on a line of its own and not the first.

A paragraph with a footnote\footnote{The footnote talks of a lemur.} and then the armadillo carries on to the end of the paragraph, which runs long enough to be set over three lines of type on the page at least.

\begin{figure}[h]
\rule{3cm}{1cm}
\caption{A long caption about the model, which predicts the state and then corrects the state using the model of the noise, so that the narwhal in the middle of it is on a line of its own, and the caption runs on for several lines.}
\end{figure}

\input{chapters/shared}
\end{document}
`;
const SI = String.raw`\documentclass[twocolumn]{article}
\begin{document}
\section{Supporting}
The supporting document is set in two columns, and its paragraph is
wrapped by hand in the source the way some writers keep it, so that each
line of the source is a part of a line of type and the quetzal sits on
the fourth line, somewhere in the middle of the column.

\begin{figure}[h]
\rule{3cm}{1cm}
\caption{A caption in two columns about the model, which predicts the state and then corrects the state using the model of the noise, so that the tapir in the middle of it is on a line of its own.}
\end{figure}

\input{chapters/shared}
\end{document}
`;
const SHARED = "The shared chapter is read by both documents, and its model of the drift is the omega model, which both documents describe in the same words, at a length that makes the page set it over several lines of type so that the wombat at the end is on a line of its own.\n";

async function watchFlashes(page: Page) {
  await page.addInitScript(() => {
    const seen: HTMLElement[] = [];
    (window as unknown as { flashes: HTMLElement[] }).flashes = seen;
    new MutationObserver((records) => {
      for (const record of records) {
        for (const node of record.addedNodes) {
          if (node instanceof HTMLElement && node.classList.contains("nx-flash")) seen.push(node);
        }
      }
    }).observe(document, { childList: true, subtree: true });
  });
}

async function setUp(app: { base: string; token: string }, project: { root: string }, page: Page) {
  mkdirSync(join(project.root, "chapters"), { recursive: true });
  writeFileSync(join(project.root, "main.tex"), MAIN);
  writeFileSync(join(project.root, "si.tex"), SI);
  writeFileSync(join(project.root, "chapters", "shared.tex"), SHARED);
  await watchFlashes(page);
  await page.goto(`${app.base}/?token=${app.token}`);
  await page.getByText("Projects", { exact: false }).first().waitFor();
  await openProject(page, project.root);
  await expect(page.locator(".nx-text-layer span", { hasText: "thesis" }).first()).toBeAttached({ timeout: 60_000 });
}

async function openFile(page: Page, path: string) {
  const parts = path.split("/");
  if (parts.length > 1 && !(await page.locator(`[role="tree"] [data-path="${path}"]`).count())) {
    await page.locator(`[role="tree"] [data-path="${parts[0]}"]`).click();
  }
  await page.locator(`[role="tree"] [data-path="${path}"]`).click();
  await expect(page.locator(`[data-tab][data-path="${path}"] button[aria-current="true"]`)).toBeVisible({ timeout: 15_000 });
}

/** The caret into `word` in the editor on screen, by clicking its letters. */
async function caretInto(page: Page, word: string) {
  await expect(page.locator(".cm-content:visible .cm-line", { hasText: word }).first()).toBeVisible();
  const at = await page.evaluate((word) => {
    const content = [...document.querySelectorAll(".cm-content")]
      .find((el) => (el as HTMLElement).offsetParent !== null)!;
    const walker = document.createTreeWalker(content, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const index = (node.textContent ?? "").indexOf(word);
      if (index < 0) continue;
      (node.parentElement as HTMLElement).scrollIntoView({ block: "center" });
      const range = document.createRange();
      range.setStart(node, index + 2);
      range.setEnd(node, index + 3);
      const box = range.getBoundingClientRect();
      return { x: box.x, y: box.y + box.height / 2 };
    }
    return null;
  }, word);
  expect(at, `"${word}" in the editor`).not.toBeNull();
  await page.mouse.click(at!.x, at!.y);
}

/** Mod-Enter with the caret in `word`, and what each flash drawn does. */
async function jump(page: Page, word: string) {
  await caretInto(page, word);
  await page.waitForTimeout(200);
  await page.evaluate(() => { (window as unknown as { flashes: HTMLElement[] }).flashes.length = 0; });
  await page.keyboard.press("Control+Enter");
  await expect.poll(() => page.evaluate(() => (window as unknown as { flashes: HTMLElement[] }).flashes.length),
    { timeout: 20_000 }).toBeGreaterThan(0);
  await page.waitForTimeout(200);
  return page.evaluate((word) => {
    const flashes = (window as unknown as { flashes: HTMLElement[] }).flashes;
    return flashes.map((flash) => {
      const on = flash.closest(".nx-page") as HTMLElement | null;
      const span = on && [...on.querySelectorAll(".nx-text-layer span")]
        .find((s) => !s.querySelector("span") && (s.textContent ?? "").includes(word));
      if (!on || !span) return `no "${word}" on the flashed page`;
      const box = on.getBoundingClientRect();
      const rect = span.getBoundingClientRect();
      const middle = rect.top + rect.height / 2 - box.top - on.clientTop;
      const top = parseFloat(flash.style.top);
      const height = parseFloat(flash.style.height);
      if (middle < top || middle > top + height) return `the flash misses "${word}"`;
      // A line of type is a little taller than its letters; a paragraph
      // is several times taller.
      if (height > Math.max(12, rect.height * 2.2)) return `the flash is ${height}px tall over a ${rect.height}px line`;
      return "ok";
    });
  }, word);
}

test("Mod-Enter flashes one line in a paragraph, a footnote and a caption", async ({ app, project, page }) => {
  await setUp(app, project, page);
  const got: Record<string, string[]> = {};
  for (const word of ["giraffe", "armadillo", "lemur", "narwhal"]) got[word] = await jump(page, word);
  expect(got).toEqual({ giraffe: ["ok"], armadillo: ["ok"], lemur: ["ok"], narwhal: ["ok"] });
});

test("Mod-Enter flashes one line in two columns and in a chapter two documents share", async ({
  app, project, page,
}) => {
  await setUp(app, project, page);
  await page.getByTestId("add-preview").click();
  await page.getByRole("menuitem", { name: "si.tex" }).click();
  await expect(page.locator(".nx-text-layer span", { hasText: "quetzal" }).first()).toBeAttached({ timeout: 60_000 });
  await openFile(page, "si.tex");
  expect(await jump(page, "quetzal"), "two columns, wrapped source").toEqual(["ok"]);
  // SyncTeX answers a caption's line here with a box around the float.
  expect(await jump(page, "tapir"), "two columns, a caption").toEqual(["ok"]);
  // The shared chapter with the two-column document in front, then with
  // the article in front.
  await openFile(page, "chapters/shared.tex");
  expect(await jump(page, "wombat"), "shared, si in front").toEqual(["ok"]);
  await page.getByTestId("preview-tab-main.tex").click();
  await expect(page.locator(".nx-text-layer span", { hasText: "thesis" }).first()).toBeAttached({ timeout: 30_000 });
  // The preview tab brings its own document to the editor.
  await openFile(page, "chapters/shared.tex");
  await expect(page.getByTestId("preview-tab-main.tex")).toHaveAttribute("aria-current", "true");
  expect(await jump(page, "wombat"), "shared, main in front").toEqual(["ok"]);
});

test("Mod-Enter right after typing, before the first build lands, finds the line", async ({
  app, project, page,
}) => {
  await setUp(app, project, page);
  await caretInto(page, "thesis");
  await page.keyboard.press("End");
  // Two new lines above the paragraph that holds "armadillo", which the
  // page on screen does not have yet.
  await page.keyboard.insertText("\n\nA new paragraph about a capybara.");
  expect(await jump(page, "armadillo")).toEqual(["ok"]);
});

/** Whether this machine's TeX has revtex, which the writer's papers use. */
function hasRevtex(): boolean {
  try {
    return execFileSync("kpsewhich", ["revtex4-2.cls"], { encoding: "utf8" }).trim().length > 0;
  } catch {
    return false;
  }
}

test("Mod-Enter in a revtex caption flashes the caption's line, not the figure", async ({ app, project, page }) => {
  test.skip(!hasRevtex(), "revtex4-2 is not installed");
  // revtex answers every line of a wrapped caption in a figure* but its
  // last with the box of the picture above it, and nothing else.
  writeFileSync(join(project.root, "main.tex"), String.raw`\documentclass[aip,jcp,reprint]{revtex4-2}
\begin{document}
The model predicts the state, and the model then corrects the state using the model of the noise, and the thesis is that it works.

\begin{figure*}[t]
  \centering
  \rule{12cm}{4cm}
  \caption{A caption across the page about the model, which predicts the state
  and then corrects the state using the model of the noise, so that the tapir
  in the middle of it is on a line of its own, and the caption runs on for a
  while longer so that it is set over two lines of type at least.}
\end{figure*}

The model predicts the state, and the model then corrects the state using the model of the noise.
\end{document}
`);
  await watchFlashes(page);
  await page.goto(`${app.base}/?token=${app.token}`);
  await page.getByText("Projects", { exact: false }).first().waitFor();
  await openProject(page, project.root);
  await expect(page.locator(".nx-text-layer span", { hasText: "tapir" }).first()).toBeAttached({ timeout: 60_000 });
  expect(await jump(page, "tapir")).toEqual(["ok"]);
});
