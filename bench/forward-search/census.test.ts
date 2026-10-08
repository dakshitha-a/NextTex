/** A census of the flash the preview gives after a build.
 *
 *  Every word of the stress documents' sources is taken as the place the
 *  caret stood when a build ran. The forward search is asked the way the
 *  server asks it, and the boxes it answers with are narrowed the way the
 *  preview narrows them. A flash is right when the box it draws holds that
 *  word as the page set it; it is exact when it is one line of type. The
 *  first box alone, which is what the preview flashed before, is counted
 *  beside it. Lines that set nothing are listed with what each flashes.
 *
 *  It is not part of the check. Run it with
 *    cd frontend && npx vitest run --config ../bench/forward-search/vitest.config.ts
 *  and read the table it writes to bench/forward-search/out/.
 */

import { execFileSync } from "node:child_process";
import { cpSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

// @ts-expect-error pdf.js ships the legacy build without types at this path
import * as pdfjs from "../../frontend/node_modules/pdfjs-dist/legacy/build/pdf.mjs";
import { placeOnPage, settingLine, type PageBox, type PageRun } from "../../frontend/src/panes/locate-on-page";
import { project } from "../../frontend/src/panes/locate-word";
import { sourceTokens, fold } from "../inverse-search/truth";

const HERE = path.dirname(new URL(import.meta.url).pathname);
const DOCS = path.join(HERE, "..", "inverse-search", "docs");
const OUT = path.join(HERE, "out");

type Item = { str: string; hasEOL: boolean; transform: number[]; width: number };

/** `synctex view`, read the way `nexttex/synctex.py` reads it. */
function forward(dir: string, pdf: string, file: string, line: number): PageBox[] {
  let out = "";
  try {
    out = execFileSync("synctex", ["view", "-i", `${line}:0:${file}`, "-o", pdf], { cwd: dir, encoding: "utf8" });
  } catch {
    return [];
  }
  const boxes: PageBox[] = [];
  for (const block of out.split(/^Page:/m).slice(1)) {
    const field = (name: string) => Number(new RegExp(`^${name}:(.*)$`, "m").exec(block)?.[1] ?? 0);
    boxes.push({ page: Number(block.split("\n")[0]), x: field("h"), y: field("v"), width: field("W"), height: field("H") });
  }
  return boxes;
}

const holds = (boxes: PageBox[], at: { page: number; x: number; y: number }) =>
  boxes.some((box) => box.page === at.page && at.y >= box.y - box.height - 1 && at.y <= box.y + 1
    && at.x >= box.x - 1 && at.x <= box.x + box.width + 1);

type Row = { doc: string; where: string; word: string; boxes: number; first: boolean; now: boolean; exact: boolean };

async function census(doc: string): Promise<{ rows: Row[]; blank: string[] }> {
  const dir = mkdtempSync(path.join(tmpdir(), "forward-"));
  cpSync(DOCS, dir, { recursive: true });
  for (let pass = 0; pass < 2; pass += 1) {
    execFileSync("pdflatex", ["-synctex=1", "-interaction=nonstopmode", `${doc}.tex`], { cwd: dir, stdio: "ignore" });
  }
  const pdfPath = path.join(dir, `${doc}.pdf`);
  const pdf = await pdfjs.getDocument({ data: new Uint8Array(readFileSync(pdfPath)), verbosity: 0 }).promise;

  // Every page's runs, and every typeset word's middle, by its fold, in
  // reading order: the k-th typeset "model" is the k-th in the source.
  const runs = new Map<number, PageRun[]>();
  const typeset = new Map<string, { page: number; x: number; y: number }[]>();
  for (let number = 1; number <= pdf.numPages; number += 1) {
    const page = await pdf.getPage(number);
    const height = page.view[3] - page.view[1];
    const items = ((await page.getTextContent()).items as Item[]).filter((item) => item.str !== undefined);
    const mine: PageRun[] = items.map((item) => {
      const size = Math.hypot(item.transform[2], item.transform[3]);
      const bottom = height - item.transform[5];
      return { str: item.str, left: item.transform[4], top: bottom - size * 0.75, bottom, width: item.width };
    });
    runs.set(number, mine);
    let text = "";
    const owner: number[] = [];
    const starts: number[] = [];
    items.forEach((item, index) => {
      starts.push(text.length);
      text += item.str;
      for (let i = 0; i < item.str.length; i += 1) owner.push(index);
      if (item.hasEOL) { text += "\n"; owner.push(-1); }
    });
    for (const segment of new Intl.Segmenter("en", { granularity: "word" }).segment(text)) {
      if (!segment.isWordLike) continue;
      const index = owner[segment.index];
      if (index === undefined || index < 0) continue;
      const item = items[index];
      const mid = segment.index - starts[index] + segment.segment.length / 2;
      const run = mine[index];
      const key = fold(segment.segment);
      if (!typeset.has(key)) typeset.set(key, []);
      typeset.get(key)!.push({
        page: number,
        x: item.transform[4] + (item.str.length ? (item.width * mid) / item.str.length : 0),
        y: (run.top + run.bottom) / 2,
      });
    }
  }
  const text = async (page: number) => runs.get(page) ?? null;

  const files = new Map<string, string[]>();
  const read = (file: string) => {
    if (!files.has(file)) files.set(file, readFileSync(path.join(dir, file), "utf8").split("\n"));
    return files.get(file)!;
  };
  const rows: Row[] = [];
  // The k-th "the" of a source line is the k-th "the" the page set inside
  // that line's boxes. Counted across the whole document instead, one word
  // that never reached the page put every later count out.
  const seen = new Map<string, number>();
  for (const token of sourceTokens(dir, `${doc}.tex`)) {
    const key = `${token.file}:${token.line}:${token.fold}`;
    const k = seen.get(key) ?? 0;
    seen.set(key, k + 1);
    const lines = read(token.file);
    const boxes = forward(dir, pdfPath, token.file, token.line);
    const where = (typeset.get(token.fold) ?? []).filter((spot) => holds(boxes, spot))[k];
    // A word that did not reach the page as itself, inside its line's
    // boxes: a key, a hyphenated half. Left out, since the census cannot
    // say where it is.
    if (!where) continue;
    const at = settingLine(lines, token.line, token.col);
    const flashed = at ? await placeOnPage(lines[at.line - 1], at.column, boxes, text) : [];
    rows.push({
      doc,
      where: `${token.file}:${token.line}:${token.col + 1}`,
      word: lines[token.line - 1].slice(token.col, token.endCol),
      boxes: boxes.length,
      first: boxes.length > 0 && holds([boxes[0]], where),
      now: holds(flashed, where),
      exact: flashed.length === 1 && holds(flashed, where),
    });
  }

  // The lines that set nothing: what the caret on each flashes.
  const blank: string[] = [];
  const main = read(`${doc}.tex`);
  for (let n = 1; n <= main.length; n += 1) {
    if (project(main[n - 1]).text.length > 0) continue;
    const at = settingLine(main, n, 0);
    const boxes = forward(dir, pdfPath, `${doc}.tex`, n);
    const flashed = at ? await placeOnPage(main[at.line - 1], at.column, boxes.length && at.line !== n
      ? forward(dir, pdfPath, `${doc}.tex`, at.line) : boxes, text) : [];
    const first = boxes[0] ? `p${boxes[0].page} y${boxes[0].y.toFixed(0)}` : "-";
    const now = flashed.map((box) => `p${box.page} y${box.y.toFixed(0)}`).join(" ") || "-";
    blank.push(`| ${doc}:${n} | \`${main[n - 1].replace(/\|/g, "\\|") || " "}\` | ${first} | ${at ? at.line : "none"} | ${now} |`);
  }
  return { rows, blank };
}

test("census", async () => {
  mkdirSync(OUT, { recursive: true });
  const rows: Row[] = [];
  const blank: string[] = [];
  for (const doc of ["stress", "stress2", "displays"]) {
    const result = await census(doc);
    rows.push(...result.rows);
    blank.push(...result.blank);
  }
  const count = (doc: string, test: (row: Row) => boolean) => rows.filter((row) => row.doc === doc && test(row)).length;
  const summary = ["stress", "stress2", "displays"].map((doc) => {
    const total = count(doc, () => true);
    return `- ${doc}: ${total} words; first box held the word ${count(doc, (r) => r.first)}; ` +
      `the flash holds it ${count(doc, (r) => r.now)}, as one line of type ${count(doc, (r) => r.exact)}`;
  });
  const lines = [
    "# Forward census",
    "",
    ...summary,
    "",
    "## Words the flash does not hold as one line",
    "",
    "| doc | where | word | boxes | first | now | exact |",
    "|---|---|---|---|---|---|---|",
    ...rows.filter((r) => !r.exact).map((r) => `| ${r.doc} | ${r.where} | ${r.word} | ${r.boxes} | ${r.first} | ${r.now} | ${r.exact} |`),
    "",
    "## Lines that set nothing",
    "",
    "| line | source | first box | walked to | flashed |",
    "|---|---|---|---|---|",
    ...blank,
  ];
  writeFileSync(path.join(OUT, `census-${process.env.CENSUS_LABEL ?? "now"}.md`), lines.join("\n") + "\n");
}, 600_000);
