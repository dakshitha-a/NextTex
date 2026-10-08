/** A census of the double-click from the page to the source.
 *
 *  Every word on every page of the stress documents is clicked the way the
 *  preview clicks it: the span pdf.js would draw, the word the browser
 *  would select, the point Pdf.tsx would ask synctex about. The answer is
 *  passed to the locator the editor uses, and what it lands on is compared
 *  with where the word really is in the source.
 *
 *  It is not part of the check. Run it with
 *    cd frontend && npx vitest run --config ../bench/inverse-search/vitest.config.ts
 *  and read the table it writes to bench/inverse-search/out/.
 */

import { execFileSync } from "node:child_process";
import { cpSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

// @ts-expect-error pdf.js ships the legacy build without types at this path
import * as pdfjs from "../../frontend/node_modules/pdfjs-dist/legacy/build/pdf.mjs";
import { locate, type Click, type Landing } from "./adapter";
import { sourceTokens, fold, type Token } from "./truth";
import { EDITS, type Edit } from "./edits";

const HERE = path.dirname(new URL(import.meta.url).pathname);
const DOCS = path.join(HERE, "docs");
const OUT = path.join(HERE, "out");

type Item = { str: string; hasEOL: boolean; transform: number[]; width: number; height: number; fontName: string };

function synctexEdit(dir: string, pdf: string, page: number, x: number, y: number): { file: string; line: number } | null {
  let out = "";
  try {
    out = execFileSync("synctex", ["edit", "-o", `${page}:${x.toFixed(2)}:${y.toFixed(2)}:${pdf}`], { cwd: dir, encoding: "utf8" });
  } catch {
    return null;
  }
  const input = /^Input:(.*)$/m.exec(out);
  const line = /^Line:(\d+)$/m.exec(out);
  if (!input || !line || Number(line[1]) <= 0) return null;
  return { file: path.relative(dir, path.resolve(dir, input[1].trim())), line: Number(line[1]) };
}

type Row = {
  doc: string;
  page: number;
  word: string;
  context: string;
  synctex: string;
  landed: string;
  expected: string;
  status: "ok" | "null" | "wrong-occurrence" | "wrong" | "unchecked" | "no-synctex";
  kind: string;
};

async function census(doc: string, edit: Edit | null): Promise<Row[]> {
  const dir = mkdtempSync(path.join(tmpdir(), "census-"));
  cpSync(DOCS, dir, { recursive: true });
  // Twice, so references and citations are numbers rather than "??".
  for (let pass = 0; pass < 2; pass += 1) {
    execFileSync("pdflatex", ["-synctex=1", "-interaction=nonstopmode", `${doc}.tex`], { cwd: dir, stdio: "ignore" });
  }
  const pdfPath = path.join(dir, `${doc}.pdf`);
  // What the writer has in the editor when they click: the built source,
  // or the source after edits made since the build.
  const files = new Map<string, string[]>();
  const read = (file: string) => {
    if (!files.has(file)) files.set(file, readFileSync(path.join(dir, file), "utf8").split("\n"));
    return files.get(file)!;
  };
  // The truth is taken from the source the PDF was built from, then moved
  // through the edit, so an edit that shifts lines shifts the answer too.
  const truth = sourceTokens(dir, `${doc}.tex`);
  let shift: (file: string, line: number) => number = (_f, line) => line;
  if (edit) {
    const lines = read(edit.file);
    edit.apply(lines);
    shift = (file, line) => (file === edit.file ? edit.move(line) : line);
  }

  const pdf = await pdfjs.getDocument({ data: new Uint8Array(readFileSync(pdfPath)), verbosity: 0 }).promise;
  const rows: Row[] = [];
  // The k-th typeset "model" is the k-th "model" in the source.
  const seen = new Map<string, number>();
  const byWord = new Map<string, Token[]>();
  for (const token of truth) {
    if (!byWord.has(token.fold)) byWord.set(token.fold, []);
    byWord.get(token.fold)!.push(token);
  }

  for (let number = 1; number <= pdf.numPages; number += 1) {
    const page = await pdf.getPage(number);
    await page.getOperatorList();
    const height = page.view[3] - page.view[1];
    const content = await page.getTextContent();
    const items = (content.items as Item[]).filter((item) => item.str !== undefined);
    const size = (item: Item) => Math.hypot(item.transform[2], item.transform[3]);

    // The text layer's text, as the browser sees it: each span's text, and
    // a line break after a span that ends its line.
    let text = "";
    const owner: number[] = [];
    const starts: number[] = [];
    items.forEach((item, index) => {
      starts.push(text.length);
      text += item.str;
      for (let i = 0; i < item.str.length; i += 1) owner.push(index);
      if (item.hasEOL) { text += "\n"; owner.push(-1); }
    });
    const spans = items.map((item) => ({ text: item.str, eol: item.hasEOL }));

    const segmenter = new Intl.Segmenter("en", { granularity: "word" });
    for (const segment of segmenter.segment(text)) {
      if (!segment.isWordLike) continue;
      const at = segment.index;
      const index = owner[at];
      if (index === undefined || index < 0) continue;
      const item = items[index];
      const offset = at - starts[index];
      const mid = Math.min(offset + segment.segment.length / 2, item.str.length);
      const x = item.transform[4] + (item.str.length ? (item.width * mid) / item.str.length : 0);
      // Pdf.tsx asks at the middle of the span, not at the pointer.
      const y = height - item.transform[5] - size(item) * 0.3;
      // The middle of the clicked character, where a pointer aimed at the
      // word lands and where Pdf.tsx measures its offset.
      const click: Click = { word: segment.segment, page: number, spans, span: index, offset: Math.floor(mid) };
      const context = item.str;

      const key = fold(segment.segment);
      const k = seen.get(key) ?? 0;
      seen.set(key, k + 1);
      const following = text.slice(at + segment.segment.length, at + segment.segment.length + 2);
      const preceding = text.slice(Math.max(0, at - 2), at);
      const broken = following === "-\n" || preceding === "-\n";
      const candidates = byWord.get(key) ?? [];

      const answer = synctexEdit(dir, pdfPath, number, x, y);
      const base: Omit<Row, "landed" | "expected" | "status" | "kind" | "synctex"> = {
        doc: edit ? `${doc}+${edit.name}` : doc,
        page: number,
        word: segment.segment,
        context,
      };
      if (!answer) {
        rows.push({ ...base, synctex: "-", landed: "-", expected: "-", status: "no-synctex", kind: "" });
        continue;
      }
      const lines = read(answer.file);
      const landing: Landing | null = locate(lines, answer.line, click);
      const landed = landing
        ? `${answer.file}:${landing.line}:${landing.from + 1}-${landing.to + 1} "${lines[landing.line - 1].slice(landing.from, landing.to)}"`
        : `${answer.file}:${answer.line}:start`;
      let expected = "?";
      let status: Row["status"] = "unchecked";
      let kind = "";
      const literal = candidates.length > 0;
      if (broken) kind = "hyphen-fragment";
      else if (!literal) kind = "no-literal-source";
      const total = candidates.length;
      if (literal && !broken) {
        const want = candidates[Math.min(k, total - 1)];
        const wantLine = shift(want.file, want.line);
        expected = `${want.file}:${wantLine}:${want.col + 1}`;
        if (!landing) status = "null";
        else {
          const sameFile = answer.file === want.file;
          const hit = sameFile && landing.line === wantLine && landing.from <= want.col && landing.to >= want.endCol;
          if (hit) status = "ok";
          else {
            const picked = fold(lines[landing.line - 1].slice(landing.from, landing.to));
            status = picked.includes(key) ? "wrong-occurrence" : "wrong";
          }
        }
        if (k >= total) kind = "more-typeset-than-source";
      } else if (!landing) {
        status = "null";
      } else if (broken) {
        // Half of a word broken at a line end: right when the whole word
        // around it is selected.
        const picked = fold(lines[landing.line - 1].slice(landing.from, landing.to));
        status = picked.includes(key) && picked.length > key.length ? "ok" : "wrong";
      }
      rows.push({ ...base, synctex: `${answer.file}:${answer.line}`, landed, expected, status, kind });
    }
  }
  return rows;
}

test("census", async () => {
  mkdirSync(OUT, { recursive: true });
  const all: Row[] = [];
  for (const doc of ["stress", "stress2", "displays"]) {
    all.push(...(await census(doc, null)));
    for (const edit of EDITS) if (edit.file === `${doc}.tex`) all.push(...(await census(doc, edit)));
  }
  const tally = new Map<string, number>();
  for (const row of all) tally.set(`${row.doc} ${row.status}`, (tally.get(`${row.doc} ${row.status}`) ?? 0) + 1);
  const bad = all.filter((row) => row.status !== "ok" && row.status !== "unchecked");
  const odd = all.filter((row) => row.status === "unchecked");
  const lines = [
    "# Census",
    "",
    ...[...tally].map(([k, v]) => `- ${k}: ${v}`),
    "",
    "## Failures",
    "",
    "| doc | p | word | synctex | landed | expected | status | kind |",
    "|---|---|---|---|---|---|---|---|",
    ...bad.map((r) => `| ${r.doc} | ${r.page} | ${r.word} | ${r.synctex} | ${r.landed.replace(/\|/g, "\\|")} | ${r.expected} | ${r.status} | ${r.kind} |`),
    "",
    "## Words with no literal source, for reading",
    "",
    "| doc | p | word | context | synctex | landed | kind |",
    "|---|---|---|---|---|---|---|",
    ...odd.map((r) => `| ${r.doc} | ${r.page} | ${r.word} | ${r.context.replace(/\|/g, "\\|")} | ${r.synctex} | ${r.landed.replace(/\|/g, "\\|")} | ${r.kind} |`),
  ];
  writeFileSync(path.join(OUT, `census-${process.env.CENSUS_LABEL ?? "now"}.md`), lines.join("\n") + "\n");
}, 600_000);
