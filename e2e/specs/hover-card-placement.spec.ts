import { test, expect, openProject } from "../fixtures";
import type { Page } from "@playwright/test";

/** The hover card keeps clear of the thing it is about, and stays for
 *  the pointer.
 *
 *  The writer's report: the cards "block the thing being hovered on and
 *  disappear when I try to click any buttons on it".  Two causes.  Under
 *  the interface size setting the tooltip layer drew the card at
 *  viewport coordinates written as CSS pixels, so at 125 % a reference's
 *  card sat on its own line, ran into the preview pane and put its
 *  buttons below the window, and the pointer could not reach them
 *  without losing the card.  And a multi-line equation near the top of
 *  the view had its card pinned over its own lines.  The card is placed
 *  by the plugin in `hover-card.ts` now, with the verb row's rule, and
 *  this drives the same four cases at 100 % and 125 %.
 */

type Rect = { x: number; y: number; w: number; h: number };

async function pointAt(page: Page, contains: string, token: string) {
  return page.evaluate(({ contains, token }) => {
    const line = [...document.querySelectorAll(".cm-line")].find((el) => el.textContent?.includes(contains));
    if (!line) return null;
    const target = line.textContent!.indexOf(token) + Math.floor(token.length / 2);
    const walker = document.createTreeWalker(line, NodeFilter.SHOW_TEXT);
    let seen = 0;
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const length = node.textContent!.length;
      if (seen + length > target) {
        const range = document.createRange();
        range.setStart(node, target - seen);
        range.setEnd(node, target - seen + 1);
        const box = range.getBoundingClientRect();
        return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
      }
      seen += length;
    }
    return null;
  }, { contains, token });
}

async function lineRect(page: Page, contains: string): Promise<Rect> {
  return page.evaluate((contains) => {
    const line = [...document.querySelectorAll(".cm-line")].find((el) => el.textContent?.includes(contains))!;
    const b = line.getBoundingClientRect();
    return { x: b.x, y: b.y, w: b.width, h: b.height };
  }, contains);
}

async function cardRect(page: Page): Promise<Rect> {
  const card = page.locator(".nx-hover-card");
  await expect(card).toBeVisible();
  const b = (await card.boundingBox())!;
  return { x: b.x, y: b.y, w: b.width, h: b.height };
}

function overlaps(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

function inside(a: Rect, b: Rect): boolean {
  return a.x >= b.x - 0.5 && a.y >= b.y - 0.5 && a.x + a.w <= b.x + b.w + 0.5 && a.y + a.h <= b.y + b.h + 0.5;
}

/** Scroll the editor so the line is near the top or the bottom of the
 *  view, walking with the keyboard first so the line is rendered. */
async function bring(page: Page, contains: string, where: "top" | "bottom") {
  const scroller = (await page.locator(".cm-scroller").boundingBox())!;
  await page.mouse.click(scroller.x + scroller.width / 2, scroller.y + scroller.height / 2);
  await page.keyboard.press("Control+Home");
  for (let i = 0; i < 80; i++) {
    if (await page.evaluate((c) => [...document.querySelectorAll(".cm-line")].some((el) => el.textContent?.includes(c)), contains)) break;
    await page.keyboard.press("PageDown");
    await page.waitForTimeout(40);
  }
  await page.evaluate(({ contains, where }) => {
    const s = document.querySelector(".cm-scroller")!;
    const line = [...document.querySelectorAll(".cm-line")].find((el) => el.textContent?.includes(contains))!;
    const sb = s.getBoundingClientRect();
    const lb = line.getBoundingClientRect();
    const scale = Number(getComputedStyle(document.documentElement).getPropertyValue("--nx-ui-scale")) || 1;
    s.scrollTop += (where === "top" ? lb.top - sb.top - 30 : lb.bottom - sb.bottom + 40) / scale;
  }, { contains, where });
  await page.waitForTimeout(250);
  await page.mouse.move(5, 5);
  await page.waitForTimeout(400);
  await expect(page.locator(".nx-hover-card")).toHaveCount(0);
}

async function hover(page: Page, contains: string, token: string) {
  const p = (await pointAt(page, contains, token))!;
  expect(p).not.toBeNull();
  await page.mouse.move(p.x, p.y);
  await page.mouse.move(p.x + 1, p.y);
  await page.locator(".nx-hover-card").waitFor({ timeout: 5_000 });
  return p;
}

/** Travel from the token to Find references in 20 px jumps, the way a
 *  hand does, and click it: the card must be there at every step, the
 *  search drawer opens, and the card goes. */
async function reachAndPress(page: Page, from: { x: number; y: number }) {
  const button = page.getByTestId("link-references");
  await expect(button).toBeVisible();
  const b = (await button.boundingBox())!;
  const tx = b.x + b.width / 2, ty = b.y + b.height / 2;
  const steps = Math.max(1, Math.ceil(Math.hypot(tx - from.x, ty - from.y) / 20));
  for (let i = 1; i <= steps; i++) {
    await page.mouse.move(from.x + ((tx - from.x) * i) / steps, from.y + ((ty - from.y) * i) / steps);
    await expect(page.locator(".nx-hover-card"), `the card at step ${i} of ${steps}`).toHaveCount(1);
  }
  await page.mouse.down();
  await page.mouse.up();
  await expect(page.getByTestId("drawer")).toHaveAttribute("data-drawer", "search");
  await expect(page.locator(".nx-hover-card")).toHaveCount(0);
}

for (const scale of [100, 125]) {
  test(`the card is clear of the text, inside the pane, and reachable at ${scale} %`, async ({
    app, project, page,
  }) => {
    await page.addInitScript((s) => localStorage.setItem("nexttex.ui.scale", String(s)), scale);
    await page.goto(`${app.base}/?token=${app.token}`);
    await page.getByText("Projects", { exact: false }).first().waitFor();
    await openProject(page, project.root);
    await page.locator(".cm-content").click();
    await page.keyboard.press("Control+End");
    await page.keyboard.type(
      "\n\\begin{equation}\nA = B\n+ C\n+ D\n+ E \\label{eq:long}\n\\end{equation}\nSee \\eqref{eq:long} now.\n" +
      "filler line\n".repeat(60),
    );
    await page.waitForTimeout(500);
    const pane = (await page.getByTestId("editor-pane").boundingBox())!;
    const paneRect = { x: pane.x, y: pane.y, w: pane.width, h: pane.height };

    // A reference low in the view: the card above it, its buttons at the
    // bottom, nearest the text.
    await bring(page, "See \\eqref", "bottom");
    let from = await hover(page, "See \\eqref", "eq:long");
    let card = await cardRect(page);
    let line = await lineRect(page, "See \\eqref");
    expect(inside(card, paneRect), JSON.stringify({ card, paneRect })).toBe(true);
    expect(overlaps(card, line), JSON.stringify({ card, line })).toBe(false);
    expect(card.y + card.h).toBeLessThanOrEqual(line.y);
    await expect(page.locator(".nx-hover-card")).toHaveAttribute("data-side", "above");
    await reachAndPress(page, from);

    // The same reference at the top of the view: the card below it, its
    // buttons at the top.
    await bring(page, "See \\eqref", "top");
    from = await hover(page, "See \\eqref", "eq:long");
    card = await cardRect(page);
    line = await lineRect(page, "See \\eqref");
    expect(inside(card, paneRect)).toBe(true);
    expect(overlaps(card, line)).toBe(false);
    expect(card.y).toBeGreaterThanOrEqual(line.y + line.h);
    await expect(page.locator(".nx-hover-card")).toHaveAttribute("data-side", "below");
    const verbs = (await page.locator(".nx-link-verbs").boundingBox())!;
    expect(verbs.y).toBeLessThan(card.y + card.h / 2);
    await reachAndPress(page, from);

    // A five line equation at the top, hovered on its third line: the
    // card below the \end line, over none of the equation's lines.
    await bring(page, "+ C", "top");
    await hover(page, "+ D", "D");
    card = await cardRect(page);
    for (const part of ["+ C", "+ D", "+ E", "end{equation}"]) {
      expect(overlaps(card, await lineRect(page, part)), part).toBe(false);
    }
    expect(inside(card, paneRect)).toBe(true);

    // A scroll puts the card away.
    await page.mouse.wheel(0, 60);
    await expect(page.locator(".nx-hover-card")).toHaveCount(0);
  });
}
