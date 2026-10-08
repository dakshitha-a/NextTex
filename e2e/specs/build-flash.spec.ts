import { test, expect, openProject } from "../fixtures";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Page } from "@playwright/test";

/** After a build, the page flashes the line of type the writer is on.
 *
 *  Each case is one the census in bench/forward-search found going wrong,
 *  or one the reading of the reveal turned up. SyncTeX answers a source
 *  line with every line of type it set, in its own order, and the first
 *  was flashed: for a paragraph written on one line, which is how writers
 *  here write, that was seldom the line being written. A caret on a line
 *  that sets nothing got whatever box SyncTeX found nearest, in the
 *  preamble the top of the first page. And the flash was drawn on the
 *  pages the build was replacing, so an edit that made a new page flashed
 *  nothing.
 */

const PARAGRAPH = "The model predicts the state, and the model then corrects the state using the model of "
  + "the noise. When the state drifts, the model is told about the drift, and the state is pulled back "
  + "towards what the model expected of the state. Every step of the model repeats this, so the state "
  + "and the model stay close, and the noise in the state is what the model learns from. The last state "
  + "the model sees is the state it reports, and the report is read by the next step, which starts "
  + "again from the state the model left it in, so that nothing the model learned is ever lost.";

const LINES = [
  String.raw`\documentclass{article}`,
  String.raw`\begin{document}`,
  String.raw`\section{Results}`,
  ``,
  PARAGRAPH,
  ``,
  String.raw`A short closing paragraph.`,
  String.raw`\end{document}`,
  ``,
];

/** Every flash drawn, with its page and its place on that page, kept as
 *  it is drawn: a flash fades within a second. */
async function watchFlashes(page: Page) {
  await page.addInitScript(() => {
    const seen: { page: number; top: number; height: number }[] = [];
    (window as unknown as { flashes: typeof seen }).flashes = seen;
    new MutationObserver((records) => {
      for (const record of records) {
        for (const node of record.addedNodes) {
          if (!(node instanceof HTMLElement) || !node.classList.contains("nx-flash")) continue;
          const pages = [...document.querySelectorAll(".nx-page")];
          seen.push({
            page: pages.indexOf(node.closest(".nx-page") as Element),
            top: parseFloat(node.style.top),
            height: parseFloat(node.style.height),
          });
        }
      }
    }).observe(document, { childList: true, subtree: true });
  });
}

async function openWith(app: { base: string; token: string }, project: { root: string }, page: Page) {
  writeFileSync(join(project.root, "main.tex"), LINES.join("\n"));
  await watchFlashes(page);
  await page.goto(`${app.base}/?token=${app.token}`);
  await page.getByText("Projects", { exact: false }).first().waitFor();
  await openProject(page, project.root);
  await expect(page.locator(".nx-text-layer span", { hasText: "closing" }).first())
    .toBeAttached({ timeout: 60_000 });
}

/** The caret to the start of 1-based `line`, then `words` words along.
 *  Clicked rather than reached with the arrows, which move by the lines
 *  the editor wraps the paragraph into. */
async function caretTo(page: Page, line: number, words = 0) {
  const box = (await page.locator(".cm-content .cm-line").nth(line - 1).boundingBox())!;
  await page.mouse.click(box.x + 1, box.y + 4);
  for (let i = 0; i < words; i += 1) await page.keyboard.press("Control+ArrowRight");
}

/** The caret to the end of the line it is on: End stops at each place the
 *  editor wrapped the line first. */
async function lineEnd(page: Page) {
  for (let i = 0; i < 12; i += 1) await page.keyboard.press("End");
}

/** The flashes drawn so far, each with whether it covers the middle of
 *  `word` as the page now sets it. */
async function flashesOver(page: Page, word: string) {
  return page.evaluate((word) => {
    const flashes = (window as unknown as { flashes: { page: number; top: number; height: number }[] }).flashes;
    const pages = [...document.querySelectorAll(".nx-page")] as HTMLElement[];
    return flashes.map((flash) => {
      const on = pages[flash.page];
      const span = on && [...on.querySelectorAll(".nx-text-layer span")]
        .find((s) => !s.querySelector("span") && (s.textContent ?? "").includes(word));
      if (!on || !span) return { ...flash, covers: false };
      const box = on.getBoundingClientRect();
      const rect = span.getBoundingClientRect();
      const middle = rect.top + rect.height / 2 - box.top - on.clientTop;
      return { ...flash, covers: middle >= flash.top && middle <= flash.top + flash.height };
    });
  }, word);
}

async function expectOneFlashOver(page: Page, word: string, pageIndex?: number) {
  await expect.poll(async () => (await flashesOver(page, word)).length, { timeout: 45_000 }).toBeGreaterThan(0);
  // The new page's text, which is laid over the picture after the flash.
  await expect(page.locator(".nx-text-layer span", { hasText: word }).first()).toBeAttached({ timeout: 20_000 });
  // Every box of one build is drawn in the same moment.
  await page.waitForTimeout(300);
  const flashes = await flashesOver(page, word);
  expect(flashes, "one line of type, not the paragraph").toHaveLength(1);
  expect(flashes[0].covers, `the flash covers "${word}"`).toBe(true);
  if (pageIndex !== undefined) expect(flashes[0].page).toBe(pageIndex);
}

test("typing in the middle of a paragraph flashes the line of type it is on", async ({ app, project, page }) => {
  await openWith(app, project, page);
  // Well into the paragraph, which the page sets as six lines or more.
  await caretTo(page, LINES.indexOf(PARAGRAPH) + 1, 60);
  await page.keyboard.insertText("zanzibar ");
  await expectOneFlashOver(page, "zanzibar");
});

test("a caret on the blank line under a paragraph flashes its last line", async ({ app, project, page }) => {
  await openWith(app, project, page);
  await caretTo(page, LINES.indexOf(PARAGRAPH) + 1);
  await lineEnd(page);
  await page.keyboard.insertText(" A quokka ends it.");
  await page.keyboard.press("Enter");
  await expectOneFlashOver(page, "quokka");
});

test("an edit in the preamble flashes nothing", async ({ app, project, page }) => {
  await openWith(app, project, page);
  await caretTo(page, 1);
  await lineEnd(page);
  await page.keyboard.insertText(" % a note in the preamble");
  // The build waits for a pause in typing, then takes a moment; the flash
  // used to land on the first line of the first page.
  await page.waitForTimeout(9000);
  expect(await flashesOver(page, "Results")).toHaveLength(0);
});

test("an edit that makes a new page flashes on that page", async ({ app, project, page }) => {
  await openWith(app, project, page);
  await expect(page.locator(".nx-page")).toHaveCount(1);
  await caretTo(page, LINES.indexOf(String.raw`A short closing paragraph.`) + 1);
  await lineEnd(page);
  await page.keyboard.insertText("\n\\newpage\nA narwhal arrives on a page of its own.");
  await expect(page.locator(".nx-page")).toHaveCount(2, { timeout: 45_000 });
  await expectOneFlashOver(page, "narwhal", 1);
});
