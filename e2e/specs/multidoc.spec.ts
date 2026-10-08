import { test, expect, openProject } from "../fixtures";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Page } from "@playwright/test";

/** The flash after a build and the double-click, across documents.
 *
 *  Two documents read one shared chapter, and the page in front decides
 *  where a caret in that chapter is shown and which source a click on it
 *  opens. Two chapters of one name in two folders must not be taken for
 *  each other. The writer asked for these paths to be tested on 8 October
 *  2026; `e2e/review/multidoc-probe.spec.ts` walks more of them by hand.
 */

const MAIN = String.raw`\documentclass{article}
\begin{document}
The main document opens with its own paragraph about the thesis.

\input{chapters/shared}
\end{document}
`;
const SI = String.raw`\documentclass{article}
\begin{document}
The supporting document opens with its own paragraph about the appendix.

\input{chapters/shared}
\end{document}
`;
const SHARED = "The shared chapter is read by both documents, and its model of the drift is the omega model.\n";

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

/** Whether every flash drawn since the count was cleared is on the page
 *  on screen and covers `word` there. */
async function flashedOver(page: Page, word: string) {
  return page.evaluate((word) => {
    const flashes = (window as unknown as { flashes: HTMLElement[] }).flashes;
    if (!flashes.length) return "no flash";
    for (const flash of flashes) {
      const on = flash.closest(".nx-page") as HTMLElement | null;
      if (!on || on.offsetParent === null) return "a flash on a page not on screen";
      const span = [...on.querySelectorAll(".nx-text-layer span")]
        .find((s) => !s.querySelector("span") && (s.textContent ?? "").includes(word));
      if (!span) return `no "${word}" on the flashed page`;
      const box = on.getBoundingClientRect();
      const rect = span.getBoundingClientRect();
      const middle = rect.top + rect.height / 2 - box.top - on.clientTop;
      const top = parseFloat(flash.style.top);
      if (middle < top || middle > top + parseFloat(flash.style.height)) return `the flash misses "${word}"`;
      if (parseFloat(flash.style.height) > Math.max(12, rect.height * 2.2)) return `the flash is taller than a line`;
    }
    return "ok";
  }, word);
}

async function setUp(app: any, project: any, page: Page) {
  mkdirSync(join(project.root, "chapters"), { recursive: true });
  writeFileSync(join(project.root, "main.tex"), MAIN);
  writeFileSync(join(project.root, "si.tex"), SI);
  writeFileSync(join(project.root, "chapters", "shared.tex"), SHARED);
  await watchFlashes(page);
  await page.goto(`${app.base}/?token=${app.token}`);
  await page.getByText("Projects", { exact: false }).first().waitFor();
  await openProject(page, project.root);
  await expect(page.locator(".nx-text-layer span", { hasText: "thesis" }).first()).toBeAttached({ timeout: 60_000 });
  await page.getByTestId("add-preview").click();
  await page.getByRole("menuitem", { name: "si.tex" }).click();
  await expect(page.getByTestId("preview-tab-si.tex")).toHaveAttribute("aria-current", "true");
  await expect(page.locator(".nx-text-layer span", { hasText: "appendix" }).first()).toBeAttached({ timeout: 60_000 });
}

async function openShared(page: Page) {
  if (!(await page.locator('[role="tree"] [data-path="chapters/shared.tex"]').count())) {
    await page.locator('[role="tree"] [data-path="chapters"]').click();
  }
  await page.locator('[role="tree"] [data-path="chapters/shared.tex"]').click();
  await expect(page.locator('[data-tab][data-path="chapters/shared.tex"] button[aria-current="true"]')).toBeVisible();
}

/** Type `word` at the end of the shared chapter's paragraph. */
async function typeInShared(page: Page, word: string) {
  await page.locator(".cm-line", { hasText: "omega model" }).first().click();
  await page.keyboard.press("End");
  await page.keyboard.press("End");
  await page.evaluate(() => { (window as unknown as { flashes: HTMLElement[] }).flashes.length = 0; });
  await page.keyboard.type(` The ${word} too.`);
  await expect(page.locator(".nx-text-layer span", { hasText: word }).first()).toBeAttached({ timeout: 45_000 });
  await expect.poll(() => flashedOver(page, word), { timeout: 20_000 }).toBe("ok");
}

async function dblclickWord(page: Page, word: string) {
  const span = page.locator(".nx-text-layer span", { hasText: word }).first();
  await expect(span).toBeAttached({ timeout: 60_000 });
  const at = await span.evaluate((el: Element, wanted: string) => {
    const range = document.createRange();
    const index = (el.textContent ?? "").indexOf(wanted);
    range.setStart(el.firstChild!, index);
    range.setEnd(el.firstChild!, index + wanted.length);
    const box = range.getBoundingClientRect();
    return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  }, word);
  await page.mouse.dblclick(at.x, at.y);
}

test("a caret in a chapter two documents read flashes on the page in front", async ({ app, project, page }) => {
  await setUp(app, project, page);
  // The supporting document is in front: the chapter's line flashes there.
  await openShared(page);
  await expect(page.getByTestId("preview-tab-si.tex")).toHaveAttribute("aria-current", "true");
  await typeInShared(page, "yak");
  // And with the main document in front, on its page.
  await page.getByTestId("preview-tab-main.tex").click();
  await openShared(page);
  await expect(page.getByTestId("preview-tab-main.tex")).toHaveAttribute("aria-current", "true");
  await typeInShared(page, "lemur");
});

test("a double-click on the shared chapter in the second document opens the chapter", async ({ app, project, page }) => {
  await setUp(app, project, page);
  await page.locator('[role="tree"] [data-path="si.tex"]').click();
  await dblclickWord(page, "omega");
  await expect(page.locator('[data-tab][data-path="chapters/shared.tex"] button[aria-current="true"]'))
    .toBeVisible({ timeout: 20_000 });
  await expect.poll(() => page.evaluate(() => window.getSelection()?.toString() ?? "")).toBe("omega");
});

test("two chapters of one name in two folders are told apart", async ({ app, project, page }) => {
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
  await dblclickWord(page, "jackal");
  await expect(page.locator('[data-tab][data-path="part2/intro.tex"] button[aria-current="true"]'))
    .toBeVisible({ timeout: 20_000 });
  await expect.poll(() => page.evaluate(() => window.getSelection()?.toString() ?? "")).toBe("jackal");
  await page.locator(".cm-line", { hasText: "jackal" }).first().click();
  await page.keyboard.press("End");
  await page.evaluate(() => { (window as unknown as { flashes: HTMLElement[] }).flashes.length = 0; });
  await page.keyboard.type(" The narwhal.");
  await expect(page.locator(".nx-text-layer span", { hasText: "narwhal" }).first()).toBeAttached({ timeout: 45_000 });
  await expect.poll(() => flashedOver(page, "narwhal"), { timeout: 20_000 }).toBe("ok");
});
