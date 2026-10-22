import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test, expect, openFolders } from "../fixtures";
import type { Page } from "@playwright/test";
import { png } from "../png";

/** Text and pictures that leave the box they are drawn in.
 *
 *  clipping.spec.ts asks whether text that does not fit is cut off without
 *  saying so.  This asks the other half: whether it is drawn past the edge
 *  of its card instead, over whatever is beside it.  The writer's report
 *  was a link pasted into the agent's composer, which ran out of its
 *  message card and off the column, and the same with a preview card
 *  whose picture had an unusual shape.  Short names wrap at their spaces
 *  in every screenshot, so the sample project never shows it; a URL, a
 *  file name made of underscores or a very tall figure does.
 *
 *  For every run of text and every picture inside a surface, the nearest
 *  ancestor that draws a box, a ground, a shadow, a border or a clip, must
 *  hold it.  A clip that scrolls or ends in an ellipsis says so and is
 *  allowed; one that does not is clipping.spec.ts's fault and is reported
 *  here too, since a card the text runs past is usually also cut.
 */

type Spill = { text: string; box: string; over: number };

async function spills(page: Page, selector: string): Promise<Spill[]> {
  return page.evaluate((selector) => {
    const found: Spill[] = [];
    const describe = (el: Element) =>
      `${el.tagName.toLowerCase()}.${(el.className?.toString() ?? "").split(/\s+/).slice(0, 4).join(".")}`;
    for (const root of document.querySelectorAll(selector)) {
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        let rects: DOMRect[];
        let text: string;
        if (node.nodeType === Node.TEXT_NODE) {
          text = node.textContent!.trim();
          if (!text) continue;
          const range = document.createRange();
          range.selectNodeContents(node);
          rects = [...range.getClientRects()].filter((r) => r.width > 0);
        } else if (node instanceof HTMLImageElement || node instanceof HTMLCanvasElement) {
          text = `<${node.tagName.toLowerCase()}>`;
          rects = [node.getBoundingClientRect()];
        } else continue;
        if (!rects.length) continue;
        for (let at = node.parentElement; at; at = at.parentElement) {
          const style = getComputedStyle(at);
          if (style.display === "contents") continue;
          const clips = style.overflowX !== "visible";
          const boxed = clips
            || !/^(transparent|rgba\(0, 0, 0, 0\))$/.test(style.backgroundColor)
            || style.boxShadow !== "none"
            || parseFloat(style.borderLeftWidth) > 0
            || parseFloat(style.borderRightWidth) > 0;
          if (boxed) {
            const box = at.getBoundingClientRect();
            // Text for a screen reader alone, the agent's name or KaTeX's
            // MathML, is clipped to a 1 px box on purpose.
            if (clips && box.width <= 1 && box.height <= 1) break;
            const over = Math.max(...rects.map((r) => Math.max(r.right - box.right, box.left - r.left)));
            const honest = clips && (
              style.overflowX === "auto" || style.overflowX === "scroll" || style.textOverflow === "ellipsis");
            if (over > 1 && !honest) {
              found.push({ text: text.slice(0, 60), box: describe(at), over: Math.round(over) });
            }
            if (clips) break;
          }
          if (at === root) break;
        }
      }
    }
    return found;
  }, selector);
}

const URL = "https://careers.appliedmaterials.com/careers/job/790318123456789?domain=appliedmaterials.com&utm_source=linkedin_jobs_board";
const LONG = "absorption_cross_sections_at_298K_and_1atm_in_three_solvents_final_v3";

test("nothing in the agent column runs out of its card", async ({ tab }) => {
  const composer = tab.locator("textarea");
  await composer.click();
  await composer.fill(`#script:longwords\nDid we make a resume for this?\n${URL}\ndomain=appliedmaterials.com`);
  await tab.getByRole("button", { name: "Send" }).click();
  await expect(tab.getByText(/Prints|Downloads chapters/)).toBeVisible({ timeout: 20_000 });
  await tab.waitForTimeout(400);
  expect(await spills(tab, "[data-testid=chat]")).toEqual([]);
  // Nor past the column, where nothing draws a box to run out of.
  const stream = tab.getByTestId("chat-stream");
  expect(await stream.evaluate((el) => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(1);
});

test("a long file name and an odd picture stay inside the tree's card", async ({ project, tab }) => {
  writeFileSync(join(project.root, "figures", `${LONG}.png`), png(12, 900));
  writeFileSync(join(project.root, "figures", "wide.png"), png(1800, 10));
  for (const name of ["wide.png", `${LONG}.png`]) {
    await openFolders(tab, `figures/${name}`);
    const row = tab.locator(`[role="tree"] [data-path="figures/${name}"]`);
    await row.scrollIntoViewIfNeeded();
    await tab.waitForTimeout(300);
    await row.hover();
    const card = tab.getByTestId("file-card");
    await expect(card, name).toBeVisible({ timeout: 10_000 });
    await expect(card.locator("img"), name).toBeVisible({ timeout: 10_000 });
    expect(await spills(tab, "[data-testid=file-card]")).toEqual([]);
    await tab.mouse.move(5, 5);
    await expect(card).toHaveCount(0);
  }
});

async function pointAt(tab: Page, contains: string, token: string) {
  return tab.evaluate(({ contains, token }) => {
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

/** The line holding `contains` scrolled into the view, since the editor
 *  draws only the lines near what is on screen. */
async function reveal(tab: Page, contains: string) {
  await tab.locator(".cm-scroller").evaluate((el) => { el.scrollTop = 0; });
  for (let step = 0; step < 60; step++) {
    const line = tab.locator(".cm-line", { hasText: contains }).first();
    if (await line.count()) {
      await line.scrollIntoViewIfNeeded();
      return;
    }
    await tab.locator(".cm-scroller").evaluate((el) => { el.scrollTop += 300; });
    await tab.waitForTimeout(50);
  }
}

/** Hovered until a card holding `ready` is drawn, then given a moment for
 *  a thumbnail or the maths to land. */
async function cardFor(tab: Page, contains: string, token: string, ready: string) {
  await tab.locator(".cm-content").evaluate((el) => (el as HTMLElement).blur());
  await expect.poll(async () => {
    await tab.mouse.move(5, 5);
    await tab.waitForTimeout(150);
    await reveal(tab, contains);
    const point = await pointAt(tab, contains, token);
    if (!point) return 0;
    await tab.mouse.move(point.x, point.y);
    await tab.mouse.move(point.x + 1, point.y);
    await tab.waitForTimeout(700);
    return tab.locator(ready).count();
  }, { timeout: 60_000, intervals: [700] }).toBeGreaterThan(0);
  await tab.waitForTimeout(800);
}

test("the editor's hover cards hold what they show, whatever its shape", async ({ project, tab }) => {
  writeFileSync(join(project.root, "figures", "tall.png"), png(12, 900));
  writeFileSync(join(project.root, "figures", `${LONG}.png`), png(1800, 10));
  const bib = join(project.root, "references.bib");
  writeFileSync(bib, `${readFileSync(bib, "utf8")}
@article{${LONG},
  author = {Abeyratne-Wickramasinghe-Jayawardena, Wilhelmina},
  title = {${LONG.replace(/_/g, "")}${LONG.replace(/_/g, "")}},
  journal = {Journal},
  year = {2024},
  doi = {10.1021/acs.jpca.supplementary.material.0123456789abcdef0123456789abcdef},
  url = {${URL}},
}
`);
  const main = join(project.root, "main.tex");
  const lines = [
    `Wide: $\\displaystyle \\sum_{i=1}^{N} \\left( a_i b_i c_i d_i e_i f_i g_i h_i i_i j_i k_i l_i m_i n_i o_i p_i q_i r_i s_i t_i u_i v_i w_i x_i y_i z_i \\right)^{2} + \\frac{\\alpha\\beta\\gamma\\delta\\epsilon\\zeta\\eta\\theta}{\\iota\\kappa\\lambda\\mu\\nu\\xi\\pi\\rho\\sigma\\tau} + \\mathrm{${LONG.replace(/_/g, "")}}$ end.`,
    "Tall: \\includegraphics{figures/tall} here.",
    `Wide figure: \\includegraphics{figures/${LONG}} here.`,
    `\\begin{figure}\\includegraphics{figures/tall}\\caption{From ${URL}.}\\label{fig:${LONG}}\\end{figure}`,
    `Refer: Figure~\\ref{fig:${LONG}} shows it.`,
    `\\begin{tabular}{llllll}\\toprule Solvent & ${LONG.replace(/_/g, "")} & Acetonitrile & Dimethylsulfoxide & Tetrahydrofuran & Dichloromethane \\\\ \\midrule Water & 0.8 & 0.9 & 1.0 & 1.1 & 1.2 \\\\ \\bottomrule\\end{tabular}`,
    `Cite: \\cite{${LONG}} again.`,
  ];
  writeFileSync(main, readFileSync(main, "utf8").replace("\\maketitle\n", `\\maketitle\n\n${lines.join("\n\n")}\n`));
  await tab.reload();
  await expect(tab.locator(".cm-line", { hasText: "Wide:" })).toBeVisible({ timeout: 30_000 });
  await openFolders(tab, "figures/tall.png");

  const cases: [string, string, string, string][] = [
    ["Wide:", "sum", ".nx-math-tooltip .katex", ".nx-math-tooltip"],
    ["Tall:", "figures/tall", ".nx-figure-tooltip .nx-thumb img", ".nx-figure-tooltip"],
    ["Wide figure:", `figures/${LONG}`, ".nx-figure-tooltip .nx-thumb img", ".nx-figure-tooltip"],
    ["Refer:", `fig:${LONG}`, ".nx-ref-tooltip .nx-thumb img", ".nx-link-tooltip"],
    ["Water", "Water", ".nx-table-tooltip table", ".nx-table-tooltip"],
    ["Cite:", LONG, ".nx-cite-title", ".nx-link-tooltip"],
  ];
  const found: Record<string, Spill[]> = {};
  for (const [contains, token, ready, card] of cases) {
    await cardFor(tab, contains, token, ready);
    const here = await spills(tab, card);
    if (here.length) found[contains] = here;
  }
  expect(found).toEqual({});
});
