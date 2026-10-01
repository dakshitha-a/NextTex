import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test, expect } from "../fixtures";
import type { Page } from "@playwright/test";

/** Limits that stay in view.
 *
 *  A venue's limits were checked by asking: the page limit lived in Before
 *  you submit, which says so only when it is run, and nothing knew a word
 *  limit at all. A word limit is set on its row in the Sections drawer and
 *  the row counts against it; a page limit shows in the strip under the
 *  source. The counting is texcount's, which this machine may not have, so
 *  the count route is answered here; what is under test is the row, the
 *  strip, and that the limit is kept with the project.
 */

/** The Sections drawer, opened unless a reload has put it back already:
 *  a second press on the lit bar button folds the drawer. */
async function sections(tab: Page) {
  const drawer = tab.getByTestId("drawer");
  if ((await drawer.getAttribute("data-drawer").catch(() => null)) !== "sections") {
    await tab.getByTestId("bar-sections").click();
  }
  await expect(drawer).toHaveAttribute("data-drawer", "sections");
}

/** Every count comes back as `words`, so a section's count is known. */
async function counting(tab: Page, words: number) {
  await tab.route("**/words?*", (route) =>
    route.fulfill({ json: { words, scope: "section" } }),
  );
}

test("a word limit is set on a row, counted against, and kept", async ({ tab, project }) => {
  await counting(tab, 260);
  await sections(tab);
  const abstract = tab.locator(".nx-section-row").filter({ hasText: "Abstract" });
  await abstract.hover();
  await abstract.getByTestId("section-limit-set").click();
  const field = abstract.getByTestId("section-limit-field");
  await expect(field).toBeFocused();
  await field.fill("250");
  await field.press("Enter");

  const count = abstract.getByTestId("section-limit");
  await expect(count).toHaveText("260 of 250");
  // Over the limit, in the warning ink.
  await expect(count).toHaveAttribute("data-over", "true");
  // The ink itself, read off the page: a class can be present and lose.
  const warn = await tab.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--warn").trim());
  const ink = await count.evaluate((el) => getComputedStyle(el).color);
  const probe = await tab.evaluate((c) => { const d = document.createElement("span"); d.style.color = c; document.body.append(d); const v = getComputedStyle(d).color; d.remove(); return v; }, warn);
  expect(ink).toBe(probe);

  // Kept with the project, where a co-author's install reads it too.
  await expect
    .poll(() => readFileSync(join(project.root, "nexttex.toml"), "utf8"))
    .toContain('"Abstract" = 250');

  // And there after a reload, now within a bigger limit.
  await tab.reload();
  await counting(tab, 260);
  await expect(tab.locator(".cm-editor")).toBeVisible({ timeout: 45_000 });
  await tab.getByTestId("drawer").waitFor();
  await sections(tab);
  const again = tab.locator(".nx-section-row").filter({ hasText: "Abstract" }).getByTestId("section-limit");
  await expect(again).toHaveText("260 of 250");
  await again.click();
  const edit = tab.getByTestId("section-limit-field");
  await edit.fill("300");
  await edit.press("Enter");
  await expect(again).toHaveText("260 of 300");
  await expect(again).not.toHaveAttribute("data-over", "true");
});

test("an emptied limit is taken away, and a row without one asks only under the pointer", async ({ tab }) => {
  await counting(tab, 40);
  await sections(tab);
  const intro = tab.locator(".nx-section-row").filter({ hasText: "Introduction" });
  // At rest the row offers nothing: a limit is asked for under the pointer.
  await expect(intro.getByTestId("section-limit-set")).toBeHidden();
  await intro.hover();
  await intro.getByTestId("section-limit-set").click();
  await intro.getByTestId("section-limit-field").fill("800");
  await intro.getByTestId("section-limit-field").press("Enter");
  await expect(intro.getByTestId("section-limit")).toHaveText("40 of 800");

  await intro.getByTestId("section-limit").click();
  await intro.getByTestId("section-limit-field").fill("");
  await intro.getByTestId("section-limit-field").press("Enter");
  await expect(intro.getByTestId("section-limit")).toHaveCount(0);

  // Escape leaves things as they were.
  await intro.hover();
  await intro.getByTestId("section-limit-set").click();
  await intro.getByTestId("section-limit-field").fill("5");
  await intro.getByTestId("section-limit-field").press("Escape");
  await expect(intro.getByTestId("section-limit")).toHaveCount(0);
});

test("the strip counts pages against the page limit once one is set", async ({ tab, app, project }) => {
  await expect(tab.locator(".cm-editor")).toBeVisible({ timeout: 45_000 });
  // The drawer and the Claude column fold, so the strip is wide enough to
  // show every segment.
  await tab.keyboard.press("Control+b");
  await tab.keyboard.press("Control+Alt+a");
  // No limit, no segment.
  await expect(tab.getByTestId("status")).toHaveAttribute("data-state", /built|warnings/, { timeout: 60_000 });
  await expect(tab.getByTestId("page-count")).toHaveCount(0);

  const setLimit = (pageLimit: number) =>
    tab.evaluate(
      async ({ base, token, id, pageLimit }) => {
        await fetch(`${base}/api/projects/${id}/settings`, {
          method: "POST",
          headers: { "content-type": "application/json", "x-nexttex-token": token },
          body: JSON.stringify({ pageLimit }),
        });
      },
      { base: app.base, token: app.token, id: project.id, pageLimit },
    );
  // A full build, so the pages are the whole document's.
  await setLimit(50);
  await tab.locator("[data-testid='status-strip'] >> text=Rebuild").click({ modifiers: ["Shift"] });
  const pages = tab.getByTestId("page-count");
  await expect(pages).toHaveText(/^\d+ of 50 pages$/, { timeout: 60_000 });
  await expect(pages).not.toHaveAttribute("data-over", "true");

  await setLimit(1);
  // The basic document is longer than one page.
  await expect(pages).toHaveText(/^\d+ of 1 page$/);
  await expect(pages).toHaveAttribute("data-over", "true");
});
