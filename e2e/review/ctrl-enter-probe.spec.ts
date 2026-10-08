import { test, expect, openProject } from "../fixtures";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Page } from "@playwright/test";

/** Mod-Enter, the jump from the caret to its place on the page, in many
 *  places and across documents. Not a check: run it with
 *    npx playwright test --config review/review.config.ts ctrl-enter-probe
 */

const LONG = "The model predicts the state, and the model then corrects the state using the model of "
  + "the noise. When the state drifts, the model is told about the drift, and the state is pulled back "
  + "towards what the model expected of the state. Every step of the model repeats this, so the state "
  + "and the model stay close, and the giraffe in the state is what the model learns from. The last state "
  + "the model sees is the state it reports, and the report is read by the next step, which starts "
  + "again from the state the model left it in, so that nothing the model learned is ever lost okapi.";

const MAIN = String.raw`\documentclass{article}
\begin{document}
\section{Main}
The main document opens with its own paragraph about the thesis.

${LONG}

A paragraph wrapped by hand in the source, as some writers do, where
each sentence sits on a line of its own and the pangolin is on the
third, which the page sets somewhere in the middle of the paragraph.

A paragraph with maths $x^2 + y^2 = z^2$ in it and a footnote\footnote{The footnote talks of a lemur.} and then the armadillo carries on to the end of the paragraph, which runs long enough to be set over three lines of type on the page at least, so that the flash can be wrong.

\begin{equation}
  E = m c^2 \label{eq:one}
\end{equation}

\begin{figure}[h]
\rule{3cm}{1cm}
\caption{A long caption about the model, which predicts the state and then corrects the state using the model of the noise, so that the narwhal in the middle of it is on a line of its own, and the caption runs on for several lines.}
\end{figure}

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
const TWO = String.raw`\documentclass[twocolumn]{article}
\begin{document}
\section{Two}
The model predicts the state, and the model then corrects the state using
the model of the noise. When the state drifts, the model is told about the
drift, and the state is pulled back towards what the model expected of the
state. Every step of the model repeats this, so the state and the model stay
close, and the quetzal in the state is what the model learns from.

\begin{figure}[h]
\rule{3cm}{1cm}
\caption{A caption in two columns about the model, which predicts the state
and then corrects the state using the model of the noise, so that the tapir
in the middle of it is on a line of its own.}
\end{figure}
\end{document}
`;
const ONE = "\\section{One}\nThe first chapter belongs to the thesis alone, and its model of the noise is the alpha model, which the chapter describes before anything else is said about it, at length, in a paragraph long enough that the page sets it on several lines, and the jaguar sits near its end where nothing else is.\n";
const SHARED = "\\section{Shared}\nThe shared chapter is read by both documents, and its model of the drift is the omega model, which both documents describe in the same words, at a length that makes the page set it over several lines of type so that the wombat at the end is on a line of its own.\n";

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

async function setUp(app: any, project: any, page: Page, both: boolean) {
  mkdirSync(join(project.root, "chapters"), { recursive: true });
  writeFileSync(join(project.root, "main.tex"), MAIN);
  writeFileSync(join(project.root, "si.tex"), SI);
  writeFileSync(join(project.root, "two.tex"), TWO);
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

/** The caret into `word` in the editor, by clicking the word's letters. */
async function caretInto(page: Page, word: string) {
  await expect(page.locator(".cm-content:visible .cm-line", { hasText: word }).first()).toBeVisible();
  const at = await page.evaluate((word) => {
    const walker = document.createTreeWalker(
      [...document.querySelectorAll(".cm-content")].find((el) => (el as HTMLElement).offsetParent !== null)!,
      NodeFilter.SHOW_TEXT,
    );
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

async function flashReport(page: Page, word: string) {
  await expect.poll(async () => page.evaluate(() => (window as any).flashes.length), { timeout: 20_000 })
    .toBeGreaterThan(0).catch(() => undefined);
  await page.waitForTimeout(400);
  return page.evaluate((word) => {
    const flashes = (window as any).flashes as HTMLElement[];
    return flashes.map((flash) => {
      const on = flash.closest(".nx-page") as HTMLElement | null;
      if (!on) return { covers: "no page" };
      const span = [...on.querySelectorAll(".nx-text-layer span")]
        .find((s) => !s.querySelector("span") && (s.textContent ?? "").includes(word));
      const top = parseFloat(flash.style.top);
      const height = parseFloat(flash.style.height);
      if (!span) return { top, height, covers: `no ${word} on the page` };
      const box = on.getBoundingClientRect();
      const rect = span.getBoundingClientRect();
      const middle = rect.top + rect.height / 2 - box.top - on.clientTop;
      return { top, height: +height.toFixed(1), span: +rect.height.toFixed(1), covers: middle >= top && middle <= top + height };
    });
  }, word);
}

async function jump(page: Page, word: string) {
  await caretInto(page, word);
  await page.waitForTimeout(300);
  await page.evaluate(() => { (window as any).flashes.length = 0; });
  await page.keyboard.press("Control+Enter");
  return flashReport(page, word);
}

const report = (name: string, value: unknown) => console.log(`PROBE ${name}: ${JSON.stringify(value)}`);

test("single document, settled build", async ({ app, project, page }) => {
  await setUp(app, project, page, false);
  for (const word of ["thesis", "giraffe", "okapi", "pangolin", "armadillo", "lemur", "narwhal"]) {
    report(`settled ${word}`, await jump(page, word));
  }
  await openFile(page, "chapters/one.tex");
  report("chapter jaguar", await jump(page, "jaguar"));
  await openFile(page, "chapters/shared.tex");
  report("shared wombat", await jump(page, "wombat"));
  await openFile(page, "main.tex");
  report("back giraffe", await jump(page, "giraffe"));
});

test("after typing, before and after the build", async ({ app, project, page }) => {
  await setUp(app, project, page, false);
  await caretInto(page, "thesis");
  await page.keyboard.press("End");
  await page.keyboard.press("Enter");
  await page.keyboard.press("Enter");
  await page.keyboard.insertText("A new paragraph about a capybara.");
  report("before build giraffe", await jump(page, "giraffe"));
  await expect(page.locator(".nx-text-layer span", { hasText: "capybara" }).first()).toBeAttached({ timeout: 60_000 });
  await page.waitForTimeout(1500);
  report("after build giraffe", await jump(page, "giraffe"));
  report("after build okapi", await jump(page, "okapi"));
});

test("two documents", async ({ app, project, page }) => {
  await setUp(app, project, page, true);
  await openFile(page, "chapters/shared.tex");
  report("si shared wombat", await jump(page, "wombat"));
  await openFile(page, "chapters/one.tex");
  report("si front, main-only jaguar", await jump(page, "jaguar"));
  await openFile(page, "si.tex");
  report("si own appendix", await jump(page, "appendix"));
  await page.getByTestId("preview-tab-main.tex").click();
  await page.waitForTimeout(1500);
  await openFile(page, "chapters/shared.tex");
  report("main shared wombat", await jump(page, "wombat"));
  await openFile(page, "main.tex");
  report("main giraffe", await jump(page, "giraffe"));
  await openFile(page, "si.tex");
  report("main front, si appendix", await jump(page, "appendix"));
});

test("reload, then jump", async ({ app, project, page }) => {
  await setUp(app, project, page, false);
  await page.reload();
  await expect(page.locator(".nx-text-layer span", { hasText: "thesis" }).first()).toBeAttached({ timeout: 60_000 });
  await page.waitForTimeout(1000);
  report("reload giraffe", await jump(page, "giraffe"));
});

test("two columns", async ({ app, project, page }) => {
  await setUp(app, project, page, false);
  await page.getByTestId("add-preview").click();
  await page.getByRole("menuitem", { name: "two.tex" }).click();
  await expect(page.locator(".nx-text-layer span", { hasText: "quetzal" }).first()).toBeAttached({ timeout: 60_000 });
  await openFile(page, "two.tex");
  for (const word of ["drifts", "quetzal", "tapir", "corrects"]) report(`two ${word}`, await jump(page, word));
});

test("snapshot: typing right after open, then after a rebuild", async ({ app, project, page }) => {
  await setUp(app, project, page, false);
  await caretInto(page, "thesis");
  await page.keyboard.press("End");
  await page.keyboard.insertText("\n\nA first new paragraph about a capybara.");
  report("first giraffe", await jump(page, "giraffe"));
  await expect(page.locator(".nx-text-layer span", { hasText: "capybara" }).first()).toBeAttached({ timeout: 60_000 });
  await page.waitForTimeout(1500);
  await caretInto(page, "capybara");
  await page.keyboard.press("End");
  await page.keyboard.insertText("\n\nA second new paragraph about a dugong.");
  report("second giraffe", await jump(page, "giraffe"));
});
