import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test, expect } from "../fixtures";

/** A published page keeps what its reader ticks.
 *
 *  The page's sandbox gives it an origin of its own, and an origin of its
 *  own has no `localStorage`: it throws, so a tracker's boxes were clear
 *  on every reload. NextTex now serves the page with a storage of its own
 *  at the top (`nexttex/pages.py`), filled from what the page kept, and
 *  posts each change back to the one route the policy lets it reach. */

const PAGE =
  "<!doctype html><html><head><title>Tracker</title></head><body>" +
  '<label><input type="checkbox" id="a"> first</label><label><input type="checkbox" id="b"> second</label>' +
  "<script>" +
  "for (const box of document.querySelectorAll('input')) {" +
  "  box.checked = localStorage.getItem(box.id) === '1';" +
  "  box.addEventListener('change', () => localStorage.setItem(box.id, box.checked ? '1' : '0'));" +
  "}" +
  "document.body.dataset.ready = String(localStorage.length);" +
  "</script></body></html>";

test("a page's ticked boxes are there after a reload and in another browser", async ({ app, project, page, browser }) => {
  const pages = join(project.root, ".nexttex", "pages");
  mkdirSync(pages, { recursive: true });
  writeFileSync(join(pages, "tracker.html"), PAGE);
  const url = `${app.base}/api/projects/${project.id}/pages/tracker`;
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });

  await page.goto(`${app.base}/?token=${app.token}`);
  await page.getByText("Projects", { exact: false }).first().waitFor();
  await page.goto(url);
  await expect(page.locator("body")).toHaveAttribute("data-ready", "0");
  await expect(page.locator("#a")).not.toBeChecked();

  // Each tick is posted at once, from the sandbox's null origin, and
  // answered so the page can read the answer.
  const posted = () => page.waitForResponse((response) => response.url().includes("/pages/tracker/state") && response.status() === 200);
  let saved = posted();
  await page.locator("#a").check();
  await saved;
  saved = posted();
  await page.locator("#b").check();
  await saved;
  await page.reload();
  await expect(page.locator("body")).toHaveAttribute("data-ready", "2");
  await expect(page.locator("#a")).toBeChecked();
  await expect(page.locator("#b")).toBeChecked();
  expect(errors).toEqual([]);

  // The same from another browser: the storage is the page's, not the tab's.
  const other = await browser.newContext();
  const elsewhere = await other.newPage();
  await elsewhere.goto(`${app.base}/?token=${app.token}`);
  await elsewhere.getByText("Projects", { exact: false }).first().waitFor();
  await elsewhere.goto(url);
  await expect(elsewhere.locator("#a")).toBeChecked();
  await expect(elsewhere.locator("#b")).toBeChecked();
  // Unticking there is a patch: the other box stays ticked.
  const unsaved = elsewhere.waitForResponse((response) => response.url().includes("/pages/tracker/state") && response.status() === 200);
  await elsewhere.locator("#a").uncheck();
  await unsaved;
  await other.close();
  await page.reload();
  await expect(page.locator("#a")).not.toBeChecked();
  await expect(page.locator("#b")).toBeChecked();
});
