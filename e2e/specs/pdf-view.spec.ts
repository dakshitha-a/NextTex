import { test, expect } from "../fixtures";
import type { Page } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { png } from "../png";

/** Reading the page: dark, two at a time, turned.
 *
 *  One View button in the preview's foot opens a short menu. The dark page
 *  is the theme's own surface and ink, with figures in their own colours;
 *  two pages sit side by side as a book opens; a turn is a quarter at a
 *  time, and SyncTeX still finds its way in both directions.
 */

const SOURCE = [
  "\\documentclass{article}",
  "\\usepackage{graphicx}",
  "\\begin{document}",
  "\\section{Results}",
  "The decay is biexponential, with a fast component that we assign to internal conversion.",
  "",
  "\\begin{center}\\includegraphics[width=3in]{figures/block.png}\\end{center}",
  "",
  "What the results mean is the subject of the second page.",
  "\\newpage",
  "The second page.",
  "\\end{document}",
  "",
].join("\n");

async function build(app: { base: string; token: string }, project: { id: string; root: string }) {
  mkdirSync(join(project.root, "figures"), { recursive: true });
  writeFileSync(join(project.root, "figures", "block.png"), png(400, 300));
  const headers = { "content-type": "application/json", "x-nexttex-token": app.token };
  await fetch(`${app.base}/api/projects/${project.id}/file`, {
    method: "PUT", headers, body: JSON.stringify({ path: "main.tex", text: SOURCE, compile: false }),
  });
  const done = await fetch(`${app.base}/api/projects/${project.id}/compile`, {
    method: "POST", headers, body: JSON.stringify({ full: true }),
  }).then((r) => r.json());
  expect(done.outcome).toBe("ok");
}

async function choose(tab: Page, item: string) {
  await tab.getByTestId("pdf-view").click();
  await tab.getByTestId("pdf-view-menu").getByTestId(item).click();
}

/** The grey of one pixel of the first page's picture, 0 to 255, at a
 *  fraction of its width and height. The page and the figure over it are
 *  read as the reader sees them: the figures' canvas where it has paint. */
async function shade(tab: Page, fx: number, fy: number): Promise<number> {
  return tab.evaluate(({ fx, fy }) => {
    // No page for a moment while the preview lays its pages out again, as
    // it does when the dark page is chosen: NaN, which no comparison
    // accepts, so a poll asks again rather than failing on a page that is
    // about to be there.
    const page = document.querySelector(".nx-page");
    if (!page) return NaN;
    const [canvas, figures] = [page.querySelector("canvas:not(.nx-figures)"), page.querySelector(".nx-figures")] as
      (HTMLCanvasElement | null)[];
    if (!canvas || !canvas.width) return NaN;
    const read = (c: HTMLCanvasElement) => {
      const data = c.getContext("2d")!.getImageData(Math.floor(c.width * fx), Math.floor(c.height * fy), 1, 1).data;
      return data;
    };
    if (figures && getComputedStyle(figures).display !== "none") {
      const top = read(figures);
      if (top[3] > 0) return Math.round((top[0] + top[1] + top[2]) / 3);
    }
    const base = read(canvas!);
    return Math.round((base[0] + base[1] + base[2]) / 3);
  }, { fx, fy });
}

/** Where the figure's middle is on the first page, as fractions of it,
 *  found from the light block in the drawn page. */
async function figureAt(tab: Page): Promise<{ fx: number; fy: number }> {
  return tab.evaluate(() => {
    const canvas = document.querySelector(".nx-page canvas") as HTMLCanvasElement | null;
    if (!canvas || !canvas.width) return { fx: NaN, fy: NaN };
    const context = canvas.getContext("2d")!;
    const { width, height } = canvas;
    const data = context.getImageData(0, 0, width, height).data;
    // The block's grey, 0xe0, and nothing else on the page is that grey.
    let sx = 0, sy = 0, n = 0;
    for (let y = 0; y < height; y += 4) {
      for (let x = 0; x < width; x += 4) {
        const at = (y * width + x) * 4;
        if (Math.abs(data[at] - 0xe0) < 6 && Math.abs(data[at + 1] - 0xe0) < 6) { sx += x; sy += y; n += 1; }
      }
    }
    return { fx: sx / n / width, fy: sy / n / height };
  });
}

test("the dark page is dark, and its figure keeps its own colours", async ({ app, project, tab }) => {
  await build(app, project);
  await expect(tab.locator(".nx-page canvas").first()).toBeVisible({ timeout: 45_000 });
  // Drawn, which a visible canvas is not yet: the figure's grey is found on
  // it and the paper is white. A fixed 1500 ms stood in for this (Q-055).
  await expect
    .poll(async () => Number.isFinite((await figureAt(tab)).fx), { timeout: 20_000 })
    .toBe(true);
  await expect.poll(() => shade(tab, 0.05, 0.05)).toBeGreaterThan(230);   // white paper
  const figure = await figureAt(tab);

  await choose(tab, "pdf-dark");
  await expect(tab.getByTestId("pdf-sheet")).toHaveAttribute("data-dark-page", "true");
  // The paper is the dark surface, not black, and the figure is still light.
  await expect.poll(() => shade(tab, 0.05, 0.05), { timeout: 15_000 }).toBeLessThan(70);
  await expect.poll(() => shade(tab, 0.05, 0.05)).toBeGreaterThan(15);
  // The paper is the dark theme's surface exactly, not a tinted grey.
  const paper = await tab.evaluate(() => {
    const canvas = document.querySelector(".nx-page canvas") as HTMLCanvasElement;
    return Array.from(canvas.getContext("2d")!.getImageData(4, 4, 1, 1).data.slice(0, 3));
  });
  const surface = await tab.evaluate(() => {
    const probe = document.createElement("div");
    probe.className = "nx-theme-dark";
    document.body.appendChild(probe);
    const value = getComputedStyle(probe).getPropertyValue("--surface").trim();
    probe.remove();
    return [1, 3, 5].map((at) => parseInt(value.slice(at, at + 2), 16));
  });
  for (let channel = 0; channel < 3; channel += 1) {
    expect(Math.abs(paper[channel] - surface[channel])).toBeLessThanOrEqual(3);
  }
  await expect.poll(() => shade(tab, figure.fx, figure.fy)).toBeGreaterThan(190);

  // Remembered, and undone from the same menu.
  await tab.reload();
  await expect(tab.getByTestId("pdf-sheet")).toHaveAttribute("data-dark-page", "true", { timeout: 45_000 });
  await choose(tab, "pdf-dark");
  await expect(tab.getByTestId("pdf-sheet")).not.toHaveAttribute("data-dark-page", "true");
  await expect.poll(() => shade(tab, 0.05, 0.05), { timeout: 15_000 }).toBeGreaterThan(230);
});

test("two pages sit side by side", async ({ app, project, tab }) => {
  await build(app, project);
  await expect(tab.locator(".nx-page").nth(1)).toBeAttached({ timeout: 45_000 });
  await choose(tab, "pdf-spread");
  await expect(tab.getByTestId("pdf-sheet")).toHaveAttribute("data-spread", "true");
  await expect.poll(async () => {
    const [a, b] = await tab.locator(".nx-page").evaluateAll((els) =>
      els.slice(0, 2).map((el) => (el as HTMLElement).getBoundingClientRect()));
    return Math.abs(a.top - b.top) < 2 && b.left > a.right;
  }, { timeout: 15_000 }).toBe(true);
  // Both fit in the pane.
  const pane = (await tab.getByTestId("pdf-sheet").boundingBox())!;
  const second = (await tab.locator(".nx-page").nth(1).boundingBox())!;
  expect(second.x + second.width).toBeLessThanOrEqual(pane.x + pane.width + 1);

  // SyncTeX both ways on the right-hand page.
  await tab.locator(".cm-content").getByText("The second page.", { exact: true }).click();
  await tab.keyboard.press("Control+Enter");
  const mark = tab.locator(".nx-page").nth(1).locator(".nx-flash");
  await expect(mark).toBeVisible({ timeout: 20_000 });
  await tab.keyboard.press("Control+Home");
  const word = await tab.evaluate(() => {
    const page = document.querySelectorAll(".nx-page")[1];
    for (const span of page.querySelectorAll(".nx-text-layer span")) {
      if (!(span.textContent ?? "").includes("second")) continue;
      const box = span.getBoundingClientRect();
      return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    }
    return null;
  });
  expect(word).not.toBeNull();
  await tab.mouse.dblclick(word!.x, word!.y);
  await expect(tab.getByTestId("caret")).toHaveText(/^Ln 11, /, { timeout: 20_000 });
});

test("a turned page still finds the source, and the source still finds it", async ({ app, project, tab }) => {
  await build(app, project);
  await expect(tab.locator(".nx-page canvas").first()).toBeVisible({ timeout: 45_000 });
  await choose(tab, "pdf-rotate");
  await expect(tab.getByTestId("pdf-sheet")).toHaveAttribute("data-rotation", "90");
  const page = tab.locator(".nx-page").first();
  await expect.poll(async () => {
    const box = (await page.boundingBox())!;
    return box.width > box.height;
  }, { timeout: 15_000 }).toBe(true);

  // From the source: the flash over a line of text stands on its end.
  await tab.locator(".cm-content").getByText("The decay is biexponential").click();
  await tab.keyboard.press("Control+Enter");
  const mark = tab.locator(".nx-flash").first();
  await expect(mark).toBeVisible({ timeout: 20_000 });
  const flash = (await mark.boundingBox())!;
  expect(flash.height).toBeGreaterThan(flash.width);

  // From the page: a double-click on that line's words lands on its line.
  await tab.locator(".cm-content").click();
  await tab.keyboard.press("Control+Home");
  const word = await tab.evaluate(() => {
    for (const span of document.querySelectorAll(".nx-page:first-child .nx-text-layer span")) {
      if (!(span.textContent ?? "").includes("biexponential")) continue;
      const box = span.getBoundingClientRect();
      return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    }
    return null;
  });
  expect(word).not.toBeNull();
  await tab.mouse.dblclick(word!.x, word!.y);
  await expect(tab.getByTestId("caret")).toHaveText(/^Ln 5, /, { timeout: 20_000 });

  // Back upright.
  await choose(tab, "pdf-upright");
  await expect(tab.getByTestId("pdf-sheet")).not.toHaveAttribute("data-rotation", "90");
});
