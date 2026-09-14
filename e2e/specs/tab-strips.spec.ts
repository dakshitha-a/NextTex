import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { test, expect, openProject } from "../fixtures";
import type { Page } from "@playwright/test";

/** The two tab strips: how many tabs show, what happens to the rest, and
 *  the gestures that reach them.
 *
 *  The preview strip showed three tabs where the header had room for
 *  seven, because a `flex-1` spacer beside a strip that was itself
 *  `flex-1` split the header between them; and the tabs past the edge
 *  scrolled away in silence, with no count and a scrollbar under a 32px
 *  row.  Both strips now squeeze their tabs before overflowing, count what
 *  they hide, list it on a press, and scroll under a wheel.
 */

const STANDALONE = (n: number) => `\\documentclass{article}
\\begin{document}
Supplementary document ${n}.
\\end{document}
`;

const ALL = ["esi.tex", "appendix.tex", "cover.tex", "poster.tex", "talk.tex", "notes.tex"];

/** Seed standalone documents and register the first `count` for preview.
 *
 *  Four extras make five tabs, which is what the preview pane holds at the
 *  default width: it is about 490px, and five tabs squeezed to their
 *  narrowest fit it with the add button beside them, and a sixth would
 *  not whatever the strip did.  Six extras make seven, which overflow at
 *  every width and are what the count and the wheel are tested against. */
async function withPreviews({ app, project, page }: any, count: number) {
  ALL.forEach((name, i) => writeFileSync(join(project.root, name), STANDALONE(i)));
  await page.goto(`${app.base}/?token=${app.token}`);
  await page.getByText("Projects", { exact: false }).first().waitFor();
  await openProject(page, project.root);
  await expect(page.locator(".cm-editor")).toBeVisible({ timeout: 30_000 });
  const docs = ALL.slice(0, count);
  for (const name of docs) {
    await page.getByTestId("add-preview").click();
    await page.getByRole("menuitem", { name }).click();
    await expect(page.getByTestId(`preview-tab-${name}`)).toBeVisible();
  }
  return docs;
}

const inside = async (page: Page, tab: string, strip: string) => {
  const t = (await page.locator(tab).boundingBox())!;
  const s = (await page.locator(strip).boundingBox())!;
  return t.x >= s.x - 1 && t.x + t.width <= s.x + s.width + 1;
};

const PREVIEW_TABS = "[data-preview-tab]";
const PREVIEW_STRIP = '[data-testid="preview-strip"]';

test("five documents are five tabs across the whole header", async ({ app, project, page }) => {
  const DOCS = await withPreviews({ app, project, page }, 4);
  await expect(page.locator(PREVIEW_TABS)).toHaveCount(5);
  for (const name of ["main.tex", ...DOCS]) {
    expect(
      await inside(page, `[data-preview-tab][data-path="${name}"]`, PREVIEW_STRIP),
      `${name} is not in the header`,
    ).toBe(true);
  }
  await expect(page.getByTestId("preview-hidden")).toHaveCount(0);
});

test("a narrower pane counts the tabs it hides, and the list brings one in front", async ({
  app, project, page,
}) => {
  const DOCS = await withPreviews({ app, project, page }, 6);
  const count = page.getByTestId("preview-hidden");
  await expect(count).toBeVisible();
  const hidden = Number(await count.innerText());
  expect(hidden).toBeGreaterThan(0);
  // The count says how many, and it is honest: that many tabs are outside
  // the strip.
  let outside = 0;
  for (const name of ["main.tex", ...DOCS]) {
    if (!(await inside(page, `[data-preview-tab][data-path="${name}"]`, PREVIEW_STRIP))) {
      outside += 1;
    }
  }
  expect(outside).toBe(hidden);

  await count.click();
  const menu = page.getByTestId("preview-hidden-menu");
  await expect(menu).toBeVisible();
  await expect(menu.getByRole("menuitem")).toHaveCount(hidden);
  await expect(menu.getByRole("menuitem").first()).toBeFocused();
  // The strip follows the tab in front, and adding put the last one in
  // front, so what is hidden is at the start: the main document first.
  await expect(menu.getByRole("menuitem").first()).toHaveText("main");
  await menu.getByRole("menuitem").first().click();
  await expect(page.getByTestId("preview-tab-main.tex")).toHaveAttribute("aria-current", "true");
  await expect
    .poll(() => inside(page, '[data-preview-tab][data-path="main.tex"]', PREVIEW_STRIP))
    .toBe(true);
  void DOCS;
});

test("a wheel over the preview header scrolls across its tabs", async ({
  app, project, page,
}) => {
  const DOCS = await withPreviews({ app, project, page }, 6);
  await expect(page.getByTestId("preview-hidden")).toBeVisible();
  // The strip follows the tab in front, which is the last one added, so
  // it is scrolled to its end and the main document is off to the left.
  const first = page.locator('[data-preview-tab][data-path="main.tex"]');
  expect(await inside(page, '[data-preview-tab][data-path="main.tex"]', PREVIEW_STRIP)).toBe(false);
  const before = (await first.boundingBox())!;
  const strip = (await page.locator(PREVIEW_STRIP).boundingBox())!;
  await page.mouse.move(strip.x + strip.width / 2, strip.y + strip.height / 2);
  // A wheel turned back, which on a row means "towards the start".
  await page.mouse.wheel(0, -400);
  await expect.poll(async () => (await first.boundingBox())!.x).toBeGreaterThan(before.x + 20);
  await expect
    .poll(() => inside(page, '[data-preview-tab][data-path="main.tex"]', PREVIEW_STRIP))
    .toBe(true);
  // And the one that was in front has scrolled out the other side; the
  // page under the header did not move.
  const last = DOCS[DOCS.length - 1];
  expect(await inside(page, `[data-preview-tab][data-path="${last}"]`, PREVIEW_STRIP)).toBe(false);
});

test("the preview tab in front has a menu, and the others keep the browser's", async ({
  app, project, page,
}) => {
  const DOCS = await withPreviews({ app, project, page }, 4);
  // Adding brought the last one in front.
  const front = DOCS[DOCS.length - 1];
  await page.locator(`[data-preview-tab][data-path="main.tex"]`).click({ button: "right" });
  await expect(page.getByTestId("preview-tab-menu")).toHaveCount(0);

  await page.locator(`[data-preview-tab][data-path="${front}"]`).click({ button: "right" });
  const menu = page.getByTestId("preview-tab-menu");
  await expect(menu).toBeVisible();
  await expect(menu.getByRole("menuitem")).toHaveText([
    "Stop previewing the others", "Download PDF",
  ]);
  await expect(menu.getByRole("menuitem").first()).toBeFocused();
  // Duplicate is a file's affair, and this is a build.
  await expect(menu.getByRole("menuitem", { name: "Duplicate" })).toHaveCount(0);

  // "The others" leaves the tab the menu was opened on and nothing else:
  // there is no main document that stays regardless, and the last one on
  // the strip cannot go.
  await menu.getByRole("menuitem", { name: "Stop previewing the others" }).click();
  await expect(page.locator(PREVIEW_TABS)).toHaveCount(0);
  await expect(page.getByText("Preview", { exact: true })).toBeVisible();
});

test("Download PDF on a preview tab fetches that document's PDF", async ({
  app, project, page,
}) => {
  const DOCS = await withPreviews({ app, project, page }, 4);
  const front = DOCS[DOCS.length - 1];
  // Wait for its build, so the download is served rather than built.
  await expect
    .poll(
      async () =>
        (await page.request.get(
          `${app.base}/api/projects/${project.id}/pdf?document=${front}`,
        )).status(),
      { timeout: 60_000 },
    )
    .toBe(200);
  const asked: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes("/download")) asked.push(request.url());
  });
  await page.locator(`[data-preview-tab][data-path="${front}"]`).click({ button: "right" });
  await page.getByRole("menuitem", { name: "Download PDF" }).click();
  await expect.poll(() => asked.length).toBeGreaterThan(0);
  const url = new URL(asked[0]);
  expect(url.searchParams.get("format")).toBe("pdf");
  expect(url.searchParams.get("document")).toBe(front);
});

test("a click on a preview tab's edge is not a click on the header", async ({
  app, project, page,
}) => {
  await withPreviews({ app, project, page }, 4);
  const tab = page.locator('[data-preview-tab][data-path="main.tex"]');
  const box = (await tab.boundingBox())!;
  // The right-hand padding of the tab, past its close button.
  await page.mouse.click(box.x + box.width - 3, box.y + box.height / 2);
  await page.waitForTimeout(500);
  await expect(page.getByTestId("collapsed-preview")).toHaveCount(0);
  await expect(page.getByTestId("preview-header")).toBeVisible();
});

/** The source strip, the same way. */
async function withManyFiles(app: any, project: any, tab: Page, names: string[]) {
  for (const name of names) {
    await fetch(`${app.base}/api/projects/${project.id}/file`, {
      method: "PUT",
      headers: { "content-type": "application/json", "x-nexttex-token": app.token },
      body: JSON.stringify({ path: name, text: `% ${name}\n`, compile: false, create: true }),
    });
  }
  for (const name of names) {
    await tab.locator(`[role="tree"] [data-path="${name}"]`).click({ timeout: 15_000 });
    await expect(tab.locator(`[data-tab][data-path="${name}"]`)).toBeVisible({
      timeout: 15_000,
    });
  }
}

const FILES = Array.from({ length: 9 }, (_, i) => `chapter-${i + 1}.tex`);

test("the source strip counts what it hides, lists it, and scrolls under a wheel", async ({
  app, project, tab,
}) => {
  await withManyFiles(app, project, tab, FILES);
  const count = tab.getByTestId("tabs-hidden");
  await expect(count).toBeVisible();
  const hidden = Number(await count.innerText());
  expect(hidden).toBeGreaterThan(0);

  await count.click();
  const menu = tab.getByTestId("tabs-hidden-menu");
  await expect(menu).toBeVisible();
  await expect(menu.getByRole("menuitem")).toHaveCount(hidden);
  await menu.getByRole("menuitem", { name: "main.tex" }).click();
  await expect(
    tab.locator('[data-tab][data-path="main.tex"] button[aria-current="true"]'),
  ).toBeVisible();
  await expect
    .poll(() => inside(tab, '[data-tab][data-path="main.tex"]', '[role="group"][aria-label="Open files"]'))
    .toBe(true);

  // Now the wheel: the last opened tab is in front and in sight, so
  // scroll back towards the start.
  const first = tab.locator('[data-tab][data-path="main.tex"]');
  const before = (await first.boundingBox())!;
  await tab.mouse.move(before.x + 10, before.y + before.height / 2);
  await tab.mouse.wheel(0, 300);
  await expect.poll(async () => (await first.boundingBox())!.x).toBeLessThan(before.x - 20);
});

test("a menu on the preview strip keeps its focus through a build", async ({
  app, project, page,
}) => {
  // The strip re-renders on every build tick, and a menu whose ref put
  // focus on its first row re-did that on every re-render, so a writer
  // walking down the list with the arrow keys was thrown back to the top
  // the moment a build started.
  await withPreviews({ app, project, page }, 2);
  const front = ALL[1];
  await page.locator(`[data-preview-tab][data-path="${front}"]`).click({ button: "right" });
  const menu = page.getByTestId("preview-tab-menu");
  await expect(menu.getByRole("menuitem").first()).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(menu.getByRole("menuitem").nth(1)).toBeFocused();

  // A build, started behind the menu.
  await page.evaluate(
    async ({ base, token, id, name }) => {
      await fetch(`${base}/api/projects/${id}/file`, {
        method: "PUT",
        headers: { "content-type": "application/json", "x-nexttex-token": token },
        body: JSON.stringify({
          path: name,
          text: "\\documentclass{article}\\begin{document}Changed.\\end{document}\n",
          compile: true,
        }),
      });
    },
    { base: app.base, token: app.token, id: project.id, name: front },
  );
  await expect(page.locator(`[data-preview-tab][data-path="${front}"] .bg-hint`).first())
    .toBeVisible({ timeout: 15_000 });
  await expect(menu.getByRole("menuitem").nth(1)).toBeFocused();
  await page.waitForTimeout(600);
  await expect(menu.getByRole("menuitem").nth(1)).toBeFocused();
});
