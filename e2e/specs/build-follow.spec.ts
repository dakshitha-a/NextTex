import { test, expect, openProject } from "../fixtures";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Page } from "@playwright/test";

/** The preview keeps up with the writing through a settling build.
 *
 *  A writer typing a double-spaced thesis pushes a line onto the next
 *  page every few sentences, and every page after it moves. The page
 *  numbers the document refers to change with them, so the fast pass is
 *  followed by a settling build, a full one. In a thesis written with
 *  `\include` the fast pass sets only the chapter being written and the
 *  settling build the whole document. The preview kept its place as a
 *  page number, which in the whole document was another chapter, and the
 *  settling build did not follow the caret, since it starts seconds after
 *  the keystroke. The writer was left at the front of the thesis.
 *
 *  The preamble counts to twelve million so that a build of the whole
 *  takes long enough for NextTex to build one chapter at a time.
 */

const VOCAB = ("analysis method results sample measure parameter model theory data curve signal noise value "
  + "field energy state system process function region boundary surface layer structure density pressure "
  + "temperature velocity flow rate change effect response control error estimate variance mean").split(" ");

function chapters(): string[][] {
  let seed = 7;
  const next = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  const words = (n: number) => Array.from({ length: n }, () => VOCAB[Math.floor(next() * VOCAB.length)]).join(" ");
  const all: string[][] = [];
  for (let c = 1; c <= 3; c += 1) {
    const lines = [String.raw`\chapter{Chapter ${c}}`, ""];
    for (let p = 0; p < 8; p += 1) {
      if (p % 2 === 0) lines.push(String.raw`\section{Part ${p}}\label{s${c}x${p}}`, "");
      const later = Math.min(6, p - (p % 2) + 2);
      lines.push(`P${c}x${p} ${words(90 + Math.floor(next() * 60))}. See page \\pageref{s${c}x${later}}.`, "");
    }
    all.push(lines);
  }
  return all;
}

const MAIN = [
  String.raw`\documentclass[12pt]{report}`,
  String.raw`\usepackage{setspace}`,
  String.raw`\doublespacing`,
  String.raw`\newcount\spin \spin=0 \loop\advance\spin by 1 \ifnum\spin<12000000\repeat`,
  String.raw`\begin{document}`,
  String.raw`\tableofcontents`,
  String.raw`\include{ch1}`,
  String.raw`\include{ch2}`,
  String.raw`\include{ch3}`,
  String.raw`\end{document}`,
  "",
];

/** Every flash drawn, with the page it is on, kept as it is drawn. */
async function watchFlashes(page: Page) {
  await page.addInitScript(() => {
    const seen: number[] = [];
    (window as unknown as { flashes: number[] }).flashes = seen;
    new MutationObserver((records) => {
      for (const record of records) {
        for (const node of record.addedNodes) {
          if (!(node instanceof HTMLElement) || !node.classList.contains("nx-flash")) continue;
          seen.push([...document.querySelectorAll(".nx-page")].indexOf(node.closest(".nx-page") as Element));
        }
      }
    }).observe(document, { childList: true, subtree: true });
  });
}

/** The preview's pages, not counting a fading copy of the old ones. */
const pageCount = (page: Page) => page.locator(".nx-page").evaluateAll(
  (pages) => pages.filter((each) => !each.closest(".nx-sheet-ghost")).length,
);

/** Where `word` is set relative to the preview's view: "in", "above",
 *  "below", or "absent" when no page on screen has its text. */
async function whereIs(page: Page, word: string) {
  return page.evaluate((word) => {
    let scroller = document.querySelector(".nx-page") as HTMLElement | null;
    while (scroller && scroller.scrollHeight <= scroller.clientHeight + 2) scroller = scroller.parentElement;
    if (!scroller) return "absent";
    const view = scroller.getBoundingClientRect();
    const span = [...document.querySelectorAll(".nx-text-layer span")].find(
      (each) => !each.closest(".nx-sheet-ghost") && !each.querySelector("span") && (each.textContent ?? "").includes(word),
    );
    if (!span) return "absent";
    const box = span.getBoundingClientRect();
    if (box.top >= view.top && box.bottom <= view.bottom) return "in";
    return box.top < view.top ? "above" : "below";
  }, word);
}

async function openChapterTwo(app: { base: string; token: string }, project: { root: string }, page: Page) {
  writeFileSync(join(project.root, "main.tex"), MAIN.join("\n"));
  chapters().forEach((lines, index) => writeFileSync(join(project.root, `ch${index + 1}.tex`), lines.join("\n")));
  // Zoomed, so a page is taller than the view, as it is for a writer
  // reading at a comfortable size.
  await page.addInitScript(() => {
    try {
      localStorage.setItem("nexttex.pdf.zoom", "1.6");
    } catch {
      /* the default zoom only makes the test easier */
    }
  });
  await watchFlashes(page);
  await page.goto(`${app.base}/?token=${app.token}`);
  await page.getByText("Projects", { exact: false }).first().waitFor();
  await openProject(page, project.root);
  await expect(page.locator(".nx-text-layer span").first()).toBeAttached({ timeout: 60_000 });
  const whole = await pageCount(page);
  await page.getByRole("treeitem", { name: /ch2\.tex/ }).click();
  await expect(page.locator(".cm-line").first()).toContainText("chapter", { timeout: 20_000 });
  // The caret to the end of the fourth paragraph, which the editor wraps:
  // End stops at each place it wrapped the line first.
  const line = page.locator(".cm-line", { hasText: "P2x3" }).first();
  for (let i = 0; i < 100 && !(await line.count()); i += 1) {
    await page.locator(".cm-scroller").evaluate((element) => { element.scrollTop += 300; });
  }
  await line.scrollIntoViewIfNeeded();
  const box = (await line.boundingBox())!;
  await page.mouse.click(box.x + 2, box.y + 4);
  for (let i = 0; i < 40; i += 1) await page.keyboard.press("End");
  // Typing until a build sets the chapter alone, which takes one build of
  // the whole first, to learn that the whole is slow.
  for (let round = 0; round < 4 && (await pageCount(page)) >= whole; round += 1) {
    await page.keyboard.insertText(` A zebu${round} wanders through the field once more.`);
    await expect.poll(() => whereIs(page, `zebu${round}`), { timeout: 60_000 }).not.toBe("absent");
  }
  const chapter = await pageCount(page);
  expect(chapter, "a build of chapter two alone").toBeLessThan(whole);
  return { whole, chapter };
}

/** A page more of chapter two moves every chapter after it, which is
 *  what makes the fast pass ask for a settling build. */
async function pushOntoANewPage(page: Page) {
  const more = Array.from({ length: 40 }, (_, i) => `${VOCAB[i % VOCAB.length]} ${VOCAB[(i * 7) % VOCAB.length]}`
    + ` ${VOCAB[(i * 11) % VOCAB.length]} ${VOCAB[(i * 13) % VOCAB.length]}`).join(" and ");
  await page.keyboard.insertText(`\n\n${more}. A narwhal arrives at the end of it.`);
}

test.setTimeout(240_000);

test("the settling build of a thesis keeps the new writing in view", async ({ app, project, page }) => {
  const { whole } = await openChapterTwo(app, project, page);
  await page.evaluate(() => { (window as unknown as { flashes: number[] }).flashes.length = 0; });
  await pushOntoANewPage(page);
  // The fast pass, one chapter, and then the settling build, the whole.
  await expect.poll(() => whereIs(page, "narwhal"), { timeout: 60_000 }).toBe("in");
  await expect.poll(() => pageCount(page), { timeout: 90_000 }).toBeGreaterThanOrEqual(whole);
  // Still there once the settling build has been laid out and revealed.
  await expect.poll(() => whereIs(page, "narwhal"), { timeout: 20_000 }).toBe("in");
  await page.waitForTimeout(1500);
  expect(await whereIs(page, "narwhal")).toBe("in");
  // And the settling build flashed it, on a page past chapter one.
  const flashes = await page.evaluate(() => (window as unknown as { flashes: number[] }).flashes);
  expect(flashes.length, "the fast pass and the settling build each flash").toBeGreaterThanOrEqual(2);
  expect(flashes[flashes.length - 1]).toBeGreaterThan(6);
});

test("a reader who scrolled away is left reading through the settling build", async ({ app, project, page }) => {
  const { chapter } = await openChapterTwo(app, project, page);
  await pushOntoANewPage(page);
  await expect.poll(() => whereIs(page, "narwhal"), { timeout: 60_000 }).toBe("in");
  expect(await pageCount(page)).toBeLessThanOrEqual(chapter + 1);
  // Up the page with the wheel, into the chapter's earlier text, while
  // the settling build runs.
  const area = await page.evaluate(() => {
    let scroller = document.querySelector(".nx-page") as HTMLElement | null;
    while (scroller && scroller.scrollHeight <= scroller.clientHeight + 2) scroller = scroller.parentElement;
    const box = scroller!.getBoundingClientRect();
    return { x: box.left + box.width / 2, y: box.top + box.height / 2 };
  });
  await page.mouse.move(area.x, area.y);
  await page.mouse.wheel(0, -1400);
  await expect.poll(() => whereIs(page, "narwhal")).not.toBe("in");
  // The line a third of the way down the view, and where it is.
  const reading = await page.evaluate(() => {
    let scroller = document.querySelector(".nx-page") as HTMLElement | null;
    while (scroller && scroller.scrollHeight <= scroller.clientHeight + 2) scroller = scroller.parentElement;
    const view = scroller!.getBoundingClientRect();
    const eye = view.top + view.height / 3;
    const spans = [...document.querySelectorAll(".nx-text-layer span")].filter(
      (each) => !each.querySelector("span") && (each.textContent ?? "").length > 30,
    ) as HTMLElement[];
    spans.sort((a, b) => Math.abs(a.getBoundingClientRect().top - eye) - Math.abs(b.getBoundingClientRect().top - eye));
    return { text: spans[0].textContent!, top: spans[0].getBoundingClientRect().top - view.top };
  });
  // The settling build sets the whole thesis, where chapter two starts
  // pages later than it does alone.
  await expect.poll(() => pageCount(page), { timeout: 90_000 }).toBeGreaterThan(chapter + 3);
  await page.waitForTimeout(2000);
  expect(await whereIs(page, "narwhal"), "not pulled back to the writing").not.toBe("in");
  const now = await page.evaluate((text) => {
    let scroller = document.querySelector(".nx-page") as HTMLElement | null;
    while (scroller && scroller.scrollHeight <= scroller.clientHeight + 2) scroller = scroller.parentElement;
    const view = scroller!.getBoundingClientRect();
    const span = [...document.querySelectorAll(".nx-text-layer span")].find(
      (each) => !each.closest(".nx-sheet-ghost") && each.textContent === text,
    );
    return span ? span.getBoundingClientRect().top - view.top : null;
  }, reading.text);
  expect(now, "the line being read is still on the page").not.toBeNull();
  expect(Math.abs(now! - reading.top), "and where it was").toBeLessThan(40);
});
