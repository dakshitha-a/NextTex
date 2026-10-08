import { test, expect, openProject } from "../fixtures";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Page } from "@playwright/test";

/** A double-click on the page selects the word it landed on.
 *
 *  Each case is one the census in bench/inverse-search found going wrong:
 *  a word used again earlier in its paragraph, which landed on the first
 *  use; maths, set as "S0" from `S_0`, which was never found; a word that is
 *  also a colour's name, which landed in `\textcolor{red}`; a heading; a
 *  table cell and a caption; an accent written as a macro; and a click on a
 *  page built before more lines were written above it.
 */

const LINES = [
  String.raw`\documentclass{article}`,
  String.raw`\usepackage{xcolor,float}`,
  String.raw`\begin{document}`,
  String.raw`\section{Results}`,
  ``,
  String.raw`The model predicts the state, and the model then corrects the state using the model of the noise.`,
  ``,
  String.raw`The ground state $S_0$ lies below the excited state, and some \textcolor{red}{important content} sits where a red marker would.`,
  ``,
  String.raw`Schr\"odinger wrote the equation down.`,
  ``,
  String.raw`\begin{table}[H]`,
  String.raw`  \centering`,
  String.raw`  \begin{tabular}{ll}`,
  String.raw`    ground & harmonic \\`,
  String.raw`    excited & anharmonic \\`,
  String.raw`  \end{tabular}`,
  String.raw`  \caption{A schematic of the apparatus.}`,
  String.raw`\end{table}`,
  String.raw`\end{document}`,
  ``,
];
const MAIN = LINES.join("\n");
const lineOf = (text: string) => LINES.findIndex((l) => l.includes(text)) + 1;

async function openWith(app: { base: string; token: string }, project: { root: string }, page: Page) {
  writeFileSync(join(project.root, "main.tex"), MAIN);
  await page.goto(`${app.base}/?token=${app.token}`);
  await page.getByText("Projects", { exact: false }).first().waitFor();
  await openProject(page, project.root);
  await expect(page.locator(".nx-text-layer span", { hasText: "anharmonic" }).first())
    .toBeAttached({ timeout: 60_000 });
}

/** The middle of `word` on the page, the word being the one that starts
 *  `at` characters into the first place the page's text reads `phrase`.
 *  The phrase may run over a line break, which the text layer writes as a
 *  break between spans; the word itself is inside one span. */
async function onPage(page: Page, phrase: string, word: string, at = phrase.indexOf(word)): Promise<[number, number]> {
  const point = await page.evaluate(({ phrase, word, at }) => {
    const spans: { node: Node; start: number }[] = [];
    let text = "";
    for (const node of document.querySelectorAll(".nx-text-layer span, .nx-text-layer br")) {
      if (node.tagName === "BR") { if (!/\s$/.test(text)) text += " "; continue; }
      if (node.querySelector("span") || !node.firstChild) continue;
      spans.push({ node: node.firstChild, start: text.length });
      text += node.textContent ?? "";
    }
    const found = text.indexOf(phrase);
    if (found < 0) return null;
    const begin = found + at;
    const host = [...spans].reverse().find((s) => s.start <= begin);
    if (!host) return null;
    const range = document.createRange();
    range.setStart(host.node, begin - host.start);
    range.setEnd(host.node, begin - host.start + word.length);
    (host.node.parentElement as HTMLElement).scrollIntoView({ block: "center" });
    const box = range.getBoundingClientRect();
    return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  }, { phrase, word, at });
  expect(point, `"${phrase}" on the page`).not.toBeNull();
  return [point!.x, point!.y];
}

/** What the editor selected, and where its end is. */
async function selected(page: Page) {
  const status = await page.getByText(/^Ln \d+, Col \d+$/).innerText();
  const [, line, col] = /Ln (\d+), Col (\d+)/.exec(status)!;
  const text = await page.evaluate(() => {
    const sel = window.getSelection();
    const inEditor = sel?.anchorNode?.parentElement?.closest(".cm-content");
    return inEditor ? String(sel) : "";
  });
  return { text, line: Number(line), end: Number(col) };
}

async function expectSelected(page: Page, text: string, line: number, from: number) {
  await expect.poll(async () => (await selected(page)).text, { timeout: 20_000 }).toBe(text);
  const now = await selected(page);
  expect(now.line).toBe(line);
  // The status bar names the selection's end, the head, 1-based.
  expect(now.end).toBe(from + text.length + 1);
}

test("a word used three times in its paragraph selects the one clicked", async ({ app, project, page }) => {
  await openWith(app, project, page);
  const line = lineOf("The model predicts");
  await page.mouse.dblclick(...(await onPage(page, "using the model of", "model")));
  await expectSelected(page, "model", line, LINES[line - 1].indexOf("model of the noise"));
  await expect(page.locator(".cm-content")).toBeFocused();
  await page.mouse.dblclick(...(await onPage(page, "the model then", "model")));
  await expectSelected(page, "model", line, LINES[line - 1].indexOf("model then"));
});

test("maths selects its source, S_0 for the S0 on the page", async ({ app, project, page }) => {
  await openWith(app, project, page);
  // `$S_0$` is set as an "S" span and a "0" span.
  const point = await page.evaluate(() => {
    const spans = [...document.querySelectorAll(".nx-text-layer span")];
    const s = spans.find((span, i) => span.textContent === "S" && (spans[i + 1]?.textContent ?? "").startsWith("0"));
    if (!s) return null;
    const box = s.getBoundingClientRect();
    return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  });
  expect(point).not.toBeNull();
  await page.mouse.dblclick(point!.x, point!.y);
  const line = lineOf("$S_0$");
  await expectSelected(page, "S_0", line, LINES[line - 1].indexOf("S_0"));
});

test("a word that names a colour selects the prose, not the colour", async ({ app, project, page }) => {
  await openWith(app, project, page);
  const line = lineOf("textcolor");
  await page.mouse.dblclick(...(await onPage(page, "where a red marker", "red")));
  await expectSelected(page, "red", line, LINES[line - 1].indexOf("red marker"));
  await page.mouse.dblclick(...(await onPage(page, "important content", "content")));
  await expectSelected(page, "content", line, LINES[line - 1].indexOf("content}"));
});

test("a heading, a table cell, a caption and an accented word are selected", async ({ app, project, page }) => {
  await openWith(app, project, page);
  await page.mouse.dblclick(...(await onPage(page, "Results", "Results")));
  await expectSelected(page, "Results", lineOf("\\section{Results}"), "\\section{".length);

  await page.mouse.dblclick(...(await onPage(page, "anharmonic", "anharmonic")));
  await expectSelected(page, "anharmonic", lineOf("anharmonic"), LINES[lineOf("anharmonic") - 1].indexOf("anharmonic"));

  await page.mouse.dblclick(...(await onPage(page, "schematic", "schematic")));
  await expectSelected(page, "schematic", lineOf("schematic"), LINES[lineOf("schematic") - 1].indexOf("schematic"));

  // The accent is set as a glyph of its own, so the page's text reads
  // "Schr¨odinger" in two pieces; the source writes it as a macro.
  await page.mouse.dblclick(...(await onPage(page, "odinger wrote", "odinger")));
  await expectSelected(page, String.raw`Schr\"odinger`, lineOf("odinger"), 0);
});

test("a click on a page built before more was written lands where the text is now", async ({ app, project, page }) => {
  await openWith(app, project, page);
  await expect
    .poll(async () => page.getByTestId("status").getAttribute("data-state"), { timeout: 45_000 })
    .toBe("built");
  // No build after the edit: the page stays the one built from the old
  // lines, which is the case a writer meets between pauses.
  await page.getByTestId("appearance").first().click();
  await page.getByTestId("settings-group-project").click();
  await page.getByRole("switch", { name: "Compile as you type" }).click();
  await page.keyboard.press("Escape");

  const added = 60;
  await page.locator(".cm-content").click();
  await page.keyboard.press("Control+Home");
  await page.keyboard.type("%\n".repeat(added));
  await expect(page.getByTestId("status")).toHaveAttribute("data-state", "stale");

  const line = lineOf("The model predicts") + added;
  await page.mouse.dblclick(...(await onPage(page, "using the model of", "model")));
  await expectSelected(page, "model", line, LINES[line - added - 1].indexOf("model of the noise"));
});
