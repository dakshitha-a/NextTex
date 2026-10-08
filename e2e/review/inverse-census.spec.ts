import { test, expect } from "../fixtures";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { sourceTokens, fold } from "../../bench/inverse-search/truth";

/** The census of bench/inverse-search, through the real app.
 *
 *  Every word on the stress document's pages is double-clicked in
 *  Chromium, on the text layer pdf.js drew, and what the editor then
 *  selects is compared with where the word is in the source. The Node
 *  census simulates the browser's word selection; this one is the truth
 *  it is checked against. Not a check: run it with
 *    npx playwright test --config review/review.config.ts inverse-census
 *  and read bench/inverse-search/out/browser-<label>.md.
 */

const BENCH = join(new URL(".", import.meta.url).pathname, "..", "..", "bench", "inverse-search");

test("every word on the stress pages, double-clicked", async ({ app, project, page }) => {
  test.setTimeout(1_800_000);
  writeFileSync(join(project.root, "main.tex"), readFileSync(join(BENCH, "docs", "stress.tex")));
  writeFileSync(join(project.root, "chapter.tex"), readFileSync(join(BENCH, "docs", "chapter.tex")));
  await page.goto(`${app.base}/?token=${app.token}`);
  await page.getByText("Projects", { exact: false }).first().waitFor();
  const { openProject } = await import("../fixtures");
  await openProject(page, project.root);
  await expect(page.locator(".nx-page").nth(2)).toBeAttached({ timeout: 90_000 });
  await page.waitForTimeout(1500);

  await page.evaluate(() => {
    document.addEventListener("dblclick", (event) => {
      const span = (event.target as HTMLElement).closest?.(".nx-text-layer span");
      (window as any).__clicked = { selection: String(window.getSelection() ?? ""), span: span?.textContent ?? "" };
    }, true);
  });

  const pages = await page.locator(".nx-page").count();
  type Row = { page: number; span: number; word: string; selection: string; path: string; line: number; from: number; to: number; selected: string; head: number };
  const rows: Row[] = [];
  for (let p = 0; p < pages; p += 1) {
    const pageEl = page.locator(".nx-page").nth(p);
    await pageEl.scrollIntoViewIfNeeded();
    await expect(pageEl.locator(".nx-text-layer span").first()).toBeAttached({ timeout: 30_000 });
    // Each word of each span, by span index and offset, so it can be found
    // again after a click has scrolled anything.
    const words = await pageEl.evaluate((el) => {
      const out: { span: number; offset: number; word: string }[] = [];
      const spans = [...el.querySelectorAll(".nx-text-layer span")].filter((s) => !s.querySelector("span"));
      const segmenter = new Intl.Segmenter("en", { granularity: "word" });
      spans.forEach((span, index) => {
        for (const segment of segmenter.segment(span.textContent ?? "")) {
          if (segment.isWordLike) out.push({ span: index, offset: segment.index, word: segment.segment });
        }
      });
      return out;
    });
    for (const target of words) {
      const point = await pageEl.evaluate((el, t) => {
        const spans = [...el.querySelectorAll(".nx-text-layer span")].filter((s) => !s.querySelector("span"));
        const span = spans[t.span] as HTMLElement;
        span.scrollIntoView({ block: "center" });
        const node = span.firstChild!;
        const range = document.createRange();
        range.setStart(node, t.offset);
        range.setEnd(node, t.offset + t.word.length);
        const box = range.getBoundingClientRect();
        return { x: box.x + box.width / 2, y: box.y + box.height / 2, w: box.width };
      }, target);
      if (point.w < 1) continue;
      const answered = page.waitForResponse((r) => r.url().includes("/synctex/inverse"), { timeout: 10_000 }).catch(() => null);
      await page.mouse.dblclick(point.x, point.y);
      const response = await answered;
      await page.waitForTimeout(response ? 250 : 50);
      // Read the way a person reads it: the status bar's caret, and the
      // selection CodeMirror mirrors into the page while it has focus. The
      // jump puts the head at the end of what it selects.
      const landed = await page.evaluate(() => {
        const tab = document.querySelector('[data-tab] button[aria-current="true"]')?.closest("[data-tab]")?.getAttribute("data-path") ?? "";
        const status = [...document.querySelectorAll("*")].find((el) => el.children.length === 0 && /^Ln \d+, Col \d+$/.test(el.textContent ?? ""))?.textContent ?? "";
        const match = /Ln (\d+), Col (\d+)/.exec(status);
        const sel = window.getSelection();
        const inEditor = !!sel?.anchorNode && !!(sel.anchorNode as Node).parentElement?.closest(".cm-content");
        const selected = inEditor ? String(sel) : "";
        const head = Number(match?.[2] ?? 1) - 1;
        return { path: tab, line: Number(match?.[1] ?? 0), from: head - selected.length, to: head, head, selected };
      });
      const clicked = await page.evaluate(() => (window as any).__clicked ?? { selection: "" });
      rows.push({ page: p + 1, span: target.span, word: target.word, selection: clicked.selection, ...landed });
    }
  }

  // The truth, as the Node census takes it: the k-th typeset "model" is
  // the k-th "model" of the source.
  const truth = sourceTokens(project.root, "main.tex").map((t) => ({ ...t, file: t.file === "main.tex" ? "main.tex" : t.file }));
  const byWord = new Map<string, typeof truth>();
  for (const token of truth) {
    if (!byWord.has(token.fold)) byWord.set(token.fold, []);
    byWord.get(token.fold)!.push(token);
  }
  const seen = new Map<string, number>();
  const tally = new Map<string, number>();
  const lines: string[] = [];
  for (const row of rows) {
    const key = fold(row.word);
    const k = seen.get(key) ?? 0;
    seen.set(key, k + 1);
    const candidates = byWord.get(key) ?? [];
    let status = "unchecked";
    let expected = "?";
    if (candidates.length) {
      const want = candidates[Math.min(k, candidates.length - 1)];
      expected = `${want.file}:${want.line}:${want.col + 1}`;
      const caretOnly = row.from === row.to;
      const inside = row.path === want.file && row.line === want.line
        && (caretOnly ? row.head >= want.col && row.head <= want.endCol : row.from <= want.col && row.to >= want.endCol);
      if (inside) status = caretOnly ? "ok-caret" : "ok-selected";
      else if (row.path === want.file && row.line === want.line && row.from === 0 && row.to === 0) status = "line-start";
      else status = fold(row.selected || "").includes(key) ? "wrong-occurrence" : "wrong";
    }
    tally.set(status, (tally.get(status) ?? 0) + 1);
    if (status !== "ok-caret" && status !== "ok-selected") {
      lines.push(`| ${row.page} | ${row.word} | ${row.selection.replace(/\|/g, "\\|").replace(/\n/g, "⏎")} | ${row.path}:${row.line}:${row.from + 1}-${row.to + 1} | ${row.selected.replace(/\|/g, "\\|").slice(0, 40)} | ${expected} | ${status} |`);
    }
  }
  mkdirSync(join(BENCH, "out"), { recursive: true });
  writeFileSync(
    join(BENCH, "out", `browser-${process.env.CENSUS_LABEL ?? "now"}.md`),
    [
      "# Browser census",
      "",
      ...[...tally].map(([k, v]) => `- ${k}: ${v}`),
      "",
      "| p | word | browser selected | landed | editor selection | expected | status |",
      "|---|---|---|---|---|---|---|",
      ...lines,
    ].join("\n") + "\n",
  );
});
