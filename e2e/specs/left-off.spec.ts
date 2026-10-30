import { test, expect, openProject } from "../fixtures";
import type { Page } from "@playwright/test";

/** Where the writer left off.
 *
 *  A project opens with the editor at the line that was at the top of the
 *  pane last time and the caret where it was, and the typeset page at the
 *  page it was left on. Both are kept per project in the browser, so a
 *  reload and a return from the projects screen bring them back.
 */

const PAGES = 8;
const SOURCE = [
  "\\documentclass{article}",
  "\\begin{document}",
  ...Array.from({ length: PAGES }, (_, page) => [
    ...Array.from({ length: 14 }, (_, n) => `Paragraph ${page * 14 + n + 1} of the long draft.\n`),
    "\\newpage",
  ]).flat(),
  "\\end{document}",
  "",
].join("\n");

async function build(app: { base: string; token: string }, project: { id: string }) {
  const headers = { "content-type": "application/json", "x-nexttex-token": app.token };
  await fetch(`${app.base}/api/projects/${project.id}/file`, {
    method: "PUT", headers, body: JSON.stringify({ path: "main.tex", text: SOURCE, compile: false }),
  });
  const done = await fetch(`${app.base}/api/projects/${project.id}/compile`, {
    method: "POST", headers, body: JSON.stringify({ full: true }),
  }).then((r) => r.json());
  expect(done.outcome).toBe("ok");
}

async function ready(tab: Page) {
  await tab.locator(".cm-editor").waitFor({ timeout: 20_000 });
  await expect(tab.getByTestId("page-number")).toBeVisible({ timeout: 30_000 });
  await expect(tab.locator(".nx-page")).toHaveCount(PAGES);
  await expect(tab.locator(".cm-content")).toContainText("of the long draft");
}

/** The text of the first line with words in it whose top is inside the
 *  editor's view. The blank lines between paragraphs are skipped: the one
 *  cut by the top edge is the line the editor keeps, and it comes back
 *  whole. */
async function topLine(tab: Page): Promise<string> {
  return tab.evaluate(() => {
    const scroller = document.querySelector(".cm-scroller")!;
    const edge = scroller.getBoundingClientRect().top;
    const line = Array.from(document.querySelectorAll(".cm-line"))
      .find((each) => each.getBoundingClientRect().top >= edge - 1 && each.textContent);
    return line?.textContent ?? "";
  });
}

/** The page whose box holds the top third of the preview's view. */
async function pageInView(tab: Page): Promise<number> {
  return tab.evaluate(() => {
    const pages = Array.from(document.querySelectorAll(".nx-page"));
    const root = pages[0].parentElement!.closest(".overflow-auto")!;
    const eye = root.getBoundingClientRect().top + root.clientHeight / 3;
    return pages.findIndex((page) => page.getBoundingClientRect().bottom > eye) + 1;
  });
}

test("the editor and the typeset page open where they were left", async ({ app, project, tab }) => {
  await build(app, project);
  await tab.reload();
  await ready(tab);

  // The editor: well down the file, with the caret on a line there.
  await tab.locator(".cm-scroller").evaluate((scroller) => { scroller.scrollTop = 900; });
  await tab.waitForTimeout(200);
  const top = await topLine(tab);
  expect(top).toMatch(/^Paragraph \d+ /);
  const below = Number(top.match(/\d+/)![0]) + 5;
  await tab.locator(".cm-line", { hasText: `Paragraph ${below} of` }).click();
  // The readout is hidden in a pane this narrow, and still written.
  await expect(tab.getByTestId("caret")).toHaveText(/^Ln \d+, Col \d+$/);
  await expect(tab.getByTestId("caret")).not.toHaveText(/^Ln 1,/);
  const caret = await tab.getByTestId("caret").textContent();

  // The page: the sixth of eight.
  await tab.getByTestId("page-number").fill("6");
  await expect.poll(() => pageInView(tab)).toBe(6);
  await tab.waitForTimeout(700);

  await tab.reload();
  await ready(tab);
  await expect.poll(() => topLine(tab)).toBe(top);
  await expect(tab.getByTestId("caret")).toHaveText(caret!);
  await expect.poll(() => pageInView(tab)).toBe(6);

  // Out to the projects screen and in again.
  await tab.getByTestId("switch-project").click();
  await tab.getByText("Projects", { exact: false }).first().waitFor();
  await openProject(tab, project.root);
  await ready(tab);
  await expect.poll(() => topLine(tab)).toBe(top);
  await expect.poll(() => pageInView(tab)).toBe(6);
});

test("a project opened for the first time starts at the top", async ({ app, project, tab }) => {
  await build(app, project);
  await tab.reload();
  await ready(tab);
  expect(await topLine(tab)).toBe("\\documentclass{article}");
  await expect(tab.getByTestId("caret")).toHaveText("Ln 1, Col 1");
  expect(await pageInView(tab)).toBe(1);
});
