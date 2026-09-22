import { test, expect } from "../fixtures";
import type { Page } from "@playwright/test";
import { landed } from "../typing";
import { watchEvents } from "../events";
import { writeFileSync } from "node:fs";
import { join } from "node:path";

/** The history panel as a piece of furniture.
 *
 *  `history-trash.spec.ts` holds what the panel promises about versions;
 *  this file holds what it promises about itself: that its header fits in
 *  its width, that a row says when it is chosen, that the controls on a
 *  row exist for a keyboard and a finger, and that Escape leaves it one
 *  level at a time.  The first of those was found by a writer, the rest by
 *  reading the file to fix it.
 */

type Box = { x: number; y: number; right: number; bottom: number };

function overlaps(a: Box, b: Box): boolean {
  return a.x < b.right && b.x < a.right && a.y < b.bottom && b.y < a.bottom;
}

async function boxOf(page: Page, selector: string): Promise<Box> {
  const box = await page.locator(selector).first().boundingBox();
  if (!box) throw new Error(`${selector} has no box`);
  return { x: box.x, y: box.y, right: box.x + box.width, bottom: box.y + box.height };
}

/** Type into the file in front, and wait until it is on disk. */
async function typeAndSave(page: Page, text: string, app: any, project: any) {
  await page.locator(".cm-content").click();
  await page.keyboard.press("Control+a");
  await page.keyboard.type(text);
  await landed(app, project, text);
}

/** The bar's History drawer, for the file in front; a second press would
 *  fold it, so the press is only made when History is not showing. */
async function openHistory(page: Page) {
  // Asked for until the drawer is the one asked for.  A press made in the
  // instant a reload is restoring the remembered drawer met that
  // restoration head on, one opening and the other folding, and the
  // panel that then showed was none; a writer presses again, so does this.
  const drawer = page.getByTestId("drawer");
  await expect
    .poll(async () => {
      const showing =
        (await drawer.count()) > 0 && (await drawer.getAttribute("data-drawer")) === "history";
      if (!showing) await page.getByTestId("bar-history").click();
      return showing;
    }, { timeout: 15_000, intervals: [400] })
    .toBe(true);
  await expect(page.getByTestId("version").first()).toBeVisible({ timeout: 10_000 });
}

test("the close arrow, the toggle and the size all fit, docked and over the editor", async ({
  tab, app, project, page,
}) => {
  await typeAndSave(tab, "the first draft of the chapter", app, project);
  await openHistory(tab);
  await expect(tab.getByTestId("history-size")).toBeVisible({ timeout: 10_000 });

  for (const width of [1600, 1100]) {
    await page.setViewportSize({ width, height: 900 });
    await tab.waitForTimeout(300);
    const panel = await boxOf(tab, '[data-testid="history-panel"]');
    const close = await boxOf(tab, '[aria-label="Close the history"]');
    const toggle = await boxOf(tab, '[data-testid="history-toolbar"] [aria-pressed]');
    const size = await boxOf(tab, '[data-testid="history-size"]');
    // Inside the panel, whole, and on nothing else.
    expect(close.x).toBeGreaterThanOrEqual(panel.x);
    expect(close.right).toBeLessThanOrEqual(panel.right);
    expect(close.right - close.x).toBeGreaterThanOrEqual(22);
    expect(overlaps(close, toggle)).toBe(false);
    expect(overlaps(close, size)).toBe(false);
    expect(overlaps(toggle, size)).toBe(false);
    // The file's name is in the header, not squeezed to nothing.
    const name = tab.getByTestId("history-header").getByText("main.tex");
    await expect(name).toBeVisible();
    const nameBox = (await name.boundingBox())!;
    expect(nameBox.width).toBeGreaterThan(30);
  }
});

test("a row shows that it is hovered, and that it is the one on screen", async ({
  tab, app, project,
}) => {
  await typeAndSave(tab, "the first draft", app, project);
  await openHistory(tab);
  const panel = tab.getByTestId("history-panel");
  const rows = tab.getByTestId("version");
  const ground = await panel.evaluate((el) => getComputedStyle(el).backgroundColor);
  const background = (index: number) =>
    rows.nth(index).evaluate((el) => getComputedStyle(el).backgroundColor);

  // At rest a row paints nothing of its own, so the panel shows through.
  const clear = "rgba(0, 0, 0, 0)";
  await tab.mouse.move(5, 5);
  expect(await background(0)).toBe(clear);
  // Under the pointer it paints a colour that is not the panel's: the
  // first version painted the panel's own, which is no hover at all.
  await rows.first().hover();
  const hovered = await background(0);
  expect(hovered).not.toBe(clear);
  expect(hovered).not.toBe(ground);
  // Chosen, it stays marked with the pointer elsewhere.
  await rows.last().click();
  await expect(tab.getByText(/viewing/i).first()).toBeVisible();
  await tab.mouse.move(5, 5);
  const count = await rows.count();
  const chosen = await background(count - 1);
  expect(chosen).not.toBe(clear);
  expect(chosen).not.toBe(ground);
});

test("the controls on a row are there for a keyboard and for the chosen row", async ({
  tab, app, project,
}) => {
  await typeAndSave(tab, "the first draft", app, project);
  await openHistory(tab);
  const row = tab.getByTestId("version").last();
  const name = row.getByRole("button", { name: /name it/i });
  await tab.mouse.move(5, 5);
  await expect(name).toBeHidden();
  // Focus inside the row reveals them, with no pointer over it.
  await row.getByRole("button", { name: /^Version from/ }).focus();
  await expect(name).toBeVisible();
  // The chosen row keeps them once focus has moved on.
  await tab.keyboard.press("Enter");
  await expect(tab.getByText(/viewing/i).first()).toBeVisible();
  // At the editor's left edge: the panel lies over its right half when
  // the agent column leaves the editor under 700px.
  await tab.locator(".cm-content").click({ position: { x: 30, y: 20 } });
  await tab.mouse.move(5, 5);
  await expect(name).toBeVisible();
});

test("Escape leaves the panel one level at a time, and the chat keeps its own", async ({
  tab, app, project,
}) => {
  await typeAndSave(tab, "the first draft", app, project);
  await openHistory(tab);
  const panel = tab.getByTestId("history-panel");
  // The keyboard arrives with the panel.
  await expect(panel).toBeFocused();
  await tab.keyboard.press("Escape");
  await expect(panel).toHaveCount(0);

  // Viewing a version: the first Escape is back to now, the second closes.
  await openHistory(tab);
  await tab.getByTestId("version").last().click();
  await expect(tab.getByText(/viewing/i).first()).toBeVisible();
  await tab.keyboard.press("Escape");
  await expect(tab.getByText(/viewing/i)).toHaveCount(0);
  await expect(panel).toBeVisible();
  await panel.focus();
  await tab.keyboard.press("Escape");
  await expect(panel).toHaveCount(0);

  // Naming a version: Escape cancels the name and nothing else.
  await openHistory(tab);
  const row = tab.getByTestId("version").last();
  await row.hover();
  await row.getByRole("button", { name: /name it/i }).click();
  const input = row.getByPlaceholder("Name this version");
  await expect(input).toBeFocused();
  await tab.keyboard.press("Escape");
  await expect(input).toHaveCount(0);
  await expect(panel).toBeVisible();

  // The chat, with the panel docked open beside the editor: Escape from
  // the composer closes the chat, as it does without the panel.
  const composer = tab.getByPlaceholder(/ask/i).first();
  await composer.click();
  await tab.keyboard.press("Escape");
  await expect(composer).toBeHidden();
  await expect(panel).toBeVisible();
});

test("a long file name in the header truncates and keeps its full path as a title", async ({
  tab, app, project, page,
}) => {
  const long = "a-chapter-with-a-deliberately-very-long-file-name-for-the-header.tex";
  writeFileSync(join(project.root, long), "\\section{Long}\n");
  await page.reload();
  await tab.locator(".cm-editor").waitFor({ timeout: 20_000 });
  await tab.locator(`[role="tree"] [data-path="${long}"]`).click();
  // The long file has to be the document in front before the typing
  // starts: the click asks the server for it and the editor swaps its
  // document when the answer lands, and a keystroke before that goes into
  // main.tex.  Once, under load, this spec timed out waiting for the
  // long file to hold "More." while it still held only its first line;
  // that was main.tex holding the sentence, not a slow autosave.
  await expect(tab.locator(".cm-content")).toContainText("Long");
  await tab.locator(".cm-content").click();
  await tab.keyboard.press("Control+End");
  await tab.keyboard.type("\nMore.\n");
  try {
    await landed(app, project, "More.", long);
  } catch (failure) {
    // Where the sentence went, for the next reader of a failure.
    const other = await fetch(
      `${app.base}/api/projects/${project.id}/file?path=main.tex`,
      { headers: { "x-nexttex-token": app.token } },
    );
    await test.info().attach("main.tex", {
      body: other.ok ? (await other.json()).text : "(unreadable)",
      contentType: "text/plain",
    });
    throw failure;
  }
  await openHistory(tab);
  const name = tab.getByTestId("history-header").getByTitle(long);
  await expect(name).toBeVisible();
  const close = await boxOf(tab, '[aria-label="Close the history"]');
  const nameBox = (await name.boundingBox())!;
  expect(nameBox.x + nameBox.width).toBeLessThanOrEqual(close.x + 1);
});

test("a Markdown file's versions reach the open panel without a build", async ({
  tab, app, project, page,
}) => {
  // The list refreshed after a build and at no other time.  A `.md` never
  // builds, so typing into one recorded versions the open panel never
  // showed.  The server says `history_changed` now, and the panel reads
  // it; the event counter shows that no build was what did it.
  writeFileSync(join(project.root, "notes.md"), "# Notes\n\nThe first line.\n");
  await page.reload();
  await tab.locator(".cm-editor").waitFor({ timeout: 20_000 });
  await tab.locator('[role="tree"] [data-path="notes.md"]').click();
  await expect(tab.getByTestId("markdown-view")).toBeVisible({ timeout: 15_000 });
  const events = await watchEvents(app, project.id);
  await tab.getByLabel("Actions for notes.md").click({ force: true });
  await tab.getByRole("tree").getByRole("button", { name: "History", exact: true }).click();
  await expect(tab.getByTestId("history-panel")).toBeVisible();
  const rows = tab.getByTestId("version");
  const before = await rows.count();

  // The build the reload started may still be landing, and a fast pass
  // that left the layout behind is followed by a settling build of its
  // own; neither is the keystroke's doing.  So wait for the builds to be
  // over, every start answered by a done, and count from there.
  const settled = async () => {
    if (events.count("compile_start") !== events.count("compile_done")) return false;
    // A settling build starts within milliseconds of the result it
    // follows; a moment's grace catches it.
    await tab.waitForTimeout(400);
    return events.count("compile_start") === events.count("compile_done");
  };
  await expect.poll(settled, { timeout: 45_000 }).toBe(true);
  const started = events.count("compile_start");

  // Two edits from this one window inside the coalescing window are one
  // version, so one edit is what this asks for: a row that was not there.
  await tab.locator(".cm-content").click({ position: { x: 30, y: 20 } });
  await tab.keyboard.press("Control+End");
  await tab.keyboard.type("\nA second line.\n");
  await landed(app, project, "A second line.", "notes.md");
  await expect.poll(() => rows.count(), { timeout: 10_000 }).toBeGreaterThan(before);
  expect(events.count("compile_start")).toBe(started);
  events.stop();
});

test("the viewing banner wraps rather than tearing its buttons in a narrow pane", async ({
  tab, app, project, page,
}) => {
  await typeAndSave(tab, "the first draft", app, project);
  await openHistory(tab);
  await tab.getByTestId("version").last().click();
  const banner = tab.getByTestId("viewing-banner");
  await expect(banner).toBeVisible();
  await page.setViewportSize({ width: 1100, height: 800 });
  await tab.waitForTimeout(300);
  // Every control is a single line of text, whole, inside the banner.
  const bannerBox = (await banner.boundingBox())!;
  for (const button of await banner.getByRole("button").all()) {
    const box = (await button.boundingBox())!;
    // The kit's inline button, 24 px, in a 32 px banner.
    expect(box.height).toBeLessThanOrEqual(26);
    expect(box.y).toBeGreaterThanOrEqual(bannerBox.y - 1);
    expect(box.y + box.height).toBeLessThanOrEqual(bannerBox.y + bannerBox.height + 1);
  }
});
