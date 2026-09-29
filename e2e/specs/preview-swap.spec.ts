import type { Page } from "@playwright/test";
import { test, expect } from "../fixtures";

/** A rebuild replaces the page without a black or a white frame.
 *
 *  The writer saw the preview flash on every build: black for a frame on a
 *  white page, and white with Dark page on. Each page was drawn straight
 *  into the canvas on screen, whose opaque context clears to black when it
 *  is resized, and a dark page was painted in its own colours before it
 *  was darkened. Now a page is drawn out of sight, darkened there, and
 *  faded in over the old one.
 *
 *  A sampler reads, on every animation frame through a rebuild, what the
 *  reader sees at one point in the first page's margin: the topmost
 *  canvas with paint there, else the page's own ground, else whatever is
 *  behind. The margin is paper, so on a white page every frame must be
 *  near white and on a dark page every frame near the dark ground.
 */

const HEADERS = (token: string) => ({ "content-type": "application/json", "x-nexttex-token": token });

const SHORT = `\\documentclass{article}
\\begin{document}
\\section{Results}
The decay is biexponential, with a fast component of 180 fs.
\\end{document}
`;
const LONGER = SHORT.replace(
  "\\end{document}",
  "\\newpage\nA second page, so the page count changes.\n\\end{document}",
);

async function put(app: { base: string; token: string }, id: string, text: string) {
  await fetch(`${app.base}/api/projects/${id}/file`, {
    method: "PUT", headers: HEADERS(app.token), body: JSON.stringify({ path: "main.tex", text, compile: false }),
  });
  const done = await fetch(`${app.base}/api/projects/${id}/compile`, {
    method: "POST", headers: HEADERS(app.token), body: JSON.stringify({ full: true }),
  }).then((r) => r.json());
  expect(done.outcome).toBe("ok");
}

/** Starts the sampler; the returned function stops it and gives the grey,
 *  0 to 255, of every frame it saw. */
async function sample(tab: Page): Promise<() => Promise<number[]>> {
  await tab.evaluate(() => {
    const page = document.querySelector(".nx-page") as HTMLElement;
    const box = page.getBoundingClientRect();
    const x = box.left + box.width * 0.06;
    const y = box.top + box.height * 0.04;
    const seen: number[] = [];
    const grey = (r: number, g: number, b: number) => Math.round(0.2126 * r + 0.7152 * g + 0.0722 * b);
    const parse = (colour: string) => {
      const m = colour.match(/\d+(\.\d+)?/g);
      return m ? grey(Number(m[0]), Number(m[1]), Number(m[2])) : NaN;
    };
    const read = (): number => {
      for (const element of document.elementsFromPoint(x, y)) {
        if (element instanceof HTMLCanvasElement) {
          if (!element.width || !element.height) continue;
          // A canvas still fading in, or one fading out under another, is
          // not what the eye reads alone; the one with most opacity wins.
          const style = getComputedStyle(element);
          let opacity = Number(style.opacity);
          for (let up = element.parentElement; up && !up.classList.contains("nx-page"); up = up.parentElement) {
            opacity *= Number(getComputedStyle(up).opacity);
          }
          if (opacity < 0.5 || style.visibility === "hidden") continue;
          const rect = element.getBoundingClientRect();
          const px = Math.floor(((x - rect.left) / rect.width) * element.width);
          const py = Math.floor(((y - rect.top) / rect.height) * element.height);
          const d = element.getContext("2d")!.getImageData(px, py, 1, 1).data;
          return grey(d[0], d[1], d[2]);
        }
        const background = getComputedStyle(element).backgroundColor;
        if (background && !background.endsWith(", 0)") && background !== "transparent") return parse(background);
      }
      return NaN;
    };
    let running = true;
    const tick = () => {
      if (!running) return;
      seen.push(read());
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    (window as unknown as { __swap: () => number[] }).__swap = () => {
      running = false;
      return seen;
    };
  });
  return () => tab.evaluate(() => (window as unknown as { __swap: () => number[] }).__swap());
}

async function drawn(tab: Page) {
  await expect(tab.locator(".nx-page canvas").first()).toBeVisible({ timeout: 45_000 });
  await tab.waitForTimeout(800);
}

for (const dark of [false, true]) {
  test(`a rebuild shows no ${dark ? "white" : "black"} frame${dark ? " on a dark page" : ""}`, async ({ app, project, tab }) => {
    await put(app, project.id, SHORT);
    await drawn(tab);
    if (dark) {
      await tab.getByTestId("pdf-view").click();
      await tab.getByTestId("pdf-view-menu").getByTestId("pdf-dark").click();
      await expect(tab.getByTestId("pdf-sheet")).toHaveAttribute("data-dark-page", "true");
      await tab.waitForTimeout(800);
    }
    for (const text of [SHORT.replace("180 fs", "182 fs"), LONGER, SHORT]) {
      const stop = await sample(tab);
      await put(app, project.id, text);
      await tab.waitForTimeout(1500);
      const frames = (await stop()).filter((v) => Number.isFinite(v));
      expect(frames.length).toBeGreaterThan(20);
      if (dark) {
        // The dark ground is the dark theme's surface, grey 40 or so; paper
        // white would be 255.
        expect(Math.max(...frames), `frames ${frames.join(",")}`).toBeLessThan(90);
        expect(Math.min(...frames), `frames ${frames.join(",")}`).toBeGreaterThan(15);
      } else {
        expect(Math.min(...frames), `frames ${frames.join(",")}`).toBeGreaterThan(200);
      }
    }
  });
}
