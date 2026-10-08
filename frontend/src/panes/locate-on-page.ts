/** Finding, on the page, the line of type an edit in the source became.
 *
 *  After a build the preview flashes where the writer was working. It
 *  asks SyncTeX's forward search, which knows the source line and nothing
 *  finer: pdfTeX records no columns, so a source line answers with every
 *  box it set. A writer's paragraph is one line, so that is every line of
 *  type in the paragraph, in no useful order, and a footnote's lines with
 *  them, on another part of the page. The preview used to flash the first
 *  box, which was a line of the paragraph chosen by SyncTeX's own order
 *  and seldom the one being written.
 *
 *  So the text around the caret is lined up with the page's text inside
 *  those boxes, both reduced to their letters and digits the way
 *  `locate-word.ts` reduces them for the double-click going the other way,
 *  and the box holding the best place is the one flashed. When nothing
 *  agrees, all the boxes are, since one of them is right.
 *
 *  Pure: the page's text comes in as items, so the census in
 *  `bench/forward-search/` runs this in Node through pdf.js.
 */

import { agreement, foldText, project } from "./locate-word";

/** A box as the forward search returns it: page points from the page's
 *  top-left corner, upright, `y` at the box's bottom. */
export type PageBox = { page: number; x: number; y: number; width: number; height: number };

/** One run of text on a page, in the same points: `top` and `bottom` of
 *  the run, `left` and `width` along the line. */
export type PageRun = { str: string; left: number; top: number; bottom: number; width: number };

/** How many characters of context on each side are compared. */
const REACH = 40;

/** Who gets the benefit of the doubt about a box's edge, in points. */
const SLACK = 1.5;

/** Not below this much agreement: a few letters agree by chance. */
const LEAST = 6;

/** A source line that is a row of a display: it aligns with `&` or ends
 *  its row with `\\`, or once its commands are gone it has no word of
 *  three letters, which every line of prose has. */
const ROW = /^[^%]*(?:[^\\]&|\\\\\s*(?:%.*)?$)/;
function isRow(line: string): boolean {
  if (ROW.test(line)) return true;
  const body = line.replace(/%.*$/, "").replace(/\\[a-zA-Z]+/g, " ");
  return /\S/.test(body) && !/[A-Za-z]{3,}/.test(body);
}

/** The boxes to flash for the caret at `column` of `line`.
 *
 *  `line` is the source line as the build read it. `text` gives a page's
 *  runs, or nothing when they cannot be had; the boxes are then returned
 *  as they came. */
export async function placeOnPage(
  line: string,
  column: number,
  boxes: PageBox[],
  text: (page: number) => Promise<PageRun[] | null>,
): Promise<PageBox[]> {
  const unique = dedupe(boxes);
  if (unique.length <= 1) return unique;
  const source = project(line);
  // The letters before the caret and after it.
  let caret = 0;
  while (caret < source.text.length && source.from[caret] < column) caret += 1;
  const left = reverse(source.text.slice(Math.max(0, caret - REACH), caret));
  const right = source.text.slice(caret, caret + REACH);
  // Whether the caret goes with the text after it rather than the text
  // before: it does when it is in a word or at one's start, and not when
  // it is at a word's end or nothing follows it on the line, the full stop
  // at the end of a paragraph being nothing.
  const after = !left.length
    || (right.length > 0 && (isLetter(line[column]) || !isLetter(line[column - 1])));
  const pages = new Map<number, PageRun[] | null>();
  const runsOf = async (page: number) => {
    if (!pages.has(page)) pages.set(page, await text(page));
    return pages.get(page)!;
  };
  // A row of a display is its own line of type, so its letters find it
  // whatever the caret's neighbours say: a `multline` shares its letters
  // across rows, and lining up the caret's context there chose the wrong
  // one. Only for a row: a paragraph's letters are spread over its lines
  // of type, and there the caret's context is what decides.
  if (isRow(line)) {
    const row = await byLetters(source.text, unique, runsOf);
    if (row) return row;
  }
  if (left.length + right.length < LEAST) return (await byLetters(source.text, unique, runsOf)) ?? outermost(unique);

  let best: { box: PageBox; score: number } | null = null;
  for (const page of [...new Set(unique.map((box) => box.page))]) {
    const runs = await runsOf(page);
    if (!runs) return outermost(unique);
    const mine = unique.filter((box) => box.page === page);
    // The page's letters inside this line's boxes, in reading order, and
    // for each the box it is in.
    let letters = "";
    const owner: PageBox[] = [];
    for (const run of runs) {
      const box = boxOf(mine, run);
      if (!box) continue;
      const folded = foldText(run.str);
      letters += folded;
      for (let i = 0; i < folded.length; i += 1) owner.push(box);
    }
    for (let at = 0; at <= letters.length; at += 1) {
      // Only where at least one side starts agreeing: the score of any
      // other place is no better than these.
      if (letters[at] !== right[0] && letters[at - 1] !== left[0]) continue;
      // The side the caret's own word is on counts twice. A footnote
      // splits its line in the source and not on the page, so the letters
      // before "works" in `method\footnote{...} works` are the footnote's,
      // and they agreed better at the foot of the page than "works well"
      // did where it was.
      const before = agreement(left, reverse(letters.slice(Math.max(0, at - REACH * 2), at)), REACH);
      const behind = agreement(right, letters.slice(at, at + REACH * 2), REACH);
      const score = after ? before + behind * 2 : before * 2 + behind;
      if (!best || score > best.score) {
        // Where a line of type ends between the two sides, the caret goes
        // with the word it is in or before, and after a word's last letter
        // with that word: the end of a line, not the start of the next.
        const box = (after ? owner[at] ?? owner[at - 1] : owner[at - 1] ?? owner[at]);
        if (box) best = { box, score };
      }
    }
  }
  const available = left.length + right.length;
  if (!best || best.score < Math.min(LEAST, available / 2)) {
    return (await byLetters(source.text, unique, runsOf)) ?? outermost(unique);
  }
  return [best.box];
}

/** How much of the line's letters must a row hold, and by how much more
 *  than the next row, to be taken for it. */
const SHARE = 0.6;
const MARGIN = 0.15;

/** When the letters around the caret cannot be lined up, the box whose
 *  letters are the line's, or nothing when no box is clearly it.
 *
 *  A display sets its pieces in an order the source does not write, a
 *  sum's limits above and below it and a fraction's parts stacked, and an
 *  `align` row is too short to line up: `a &= b + c` is three letters.
 *  SyncTeX answers every line of an `align` with every row of it, and a
 *  `split` with the whole equation and its rows inside it, so the caret
 *  on one row flashed them all. The letters still say which row is which:
 *  counted as a bag, since the order inside a row is the display's, and in
 *  order as well, so two rows of the same letters, `a = b + c` and
 *  `c = b + a`, are told apart. Every box is a candidate, the rows inside
 *  a display's box among them, and the share is of the line's letters and
 *  of the box's, so the whole display holding a row's letters by chance
 *  does not win over the row. */
async function byLetters(
  letters: string,
  boxes: PageBox[],
  text: (page: number) => Promise<PageRun[] | null>,
): Promise<PageBox[] | null> {
  if (boxes.length <= 1 || !letters.length) return null;
  const want = bag(letters);
  const scored: Array<{ box: PageBox; share: number }> = [];
  for (const box of boxes) {
    const runs = await text(box.page);
    if (!runs) return null;
    let held = "";
    for (const run of runs) {
      if (boxOf([box], run)) held += foldText(run.str);
    }
    if (!held.length) continue;
    const have = bag(held);
    let common = 0;
    for (const [char, count] of want) common += Math.min(count, have.get(char) ?? 0);
    const most = Math.max(letters.length, held.length);
    scored.push({ box, share: (common / most + inOrder(letters, held) / most) / 2 });
  }
  scored.sort((a, b) => b.share - a.share);
  const first = scored[0];
  if (!first || first.share < SHARE) return null;
  // The rival is the best box on another row: SyncTeX gives a row as a
  // line of type and again as the pieces inside it, which score alike.
  const rival = scored.find((each) => !sameRow(each.box, first.box));
  if (rival && first.share - rival.share < MARGIN) return null;
  return [first.box];
}

/** Whether two boxes are on one row of type: on one page, and most of the
 *  shorter one's height inside the other's. */
function sameRow(a: PageBox, b: PageBox): boolean {
  if (a.page !== b.page) return false;
  const overlap = Math.min(a.y, b.y) - Math.max(a.y - a.height, b.y - b.height);
  return overlap > 0.5 * Math.min(a.height, b.height);
}

/** The longest run of `a`'s letters found in `b` in the same order. */
function inOrder(a: string, b: string): number {
  let row = new Array<number>(b.length + 1).fill(0);
  for (let i = 1; i <= a.length; i += 1) {
    const next = new Array<number>(b.length + 1).fill(0);
    for (let j = 1; j <= b.length; j += 1) {
      next[j] = a[i - 1] === b[j - 1] ? row[j - 1] + 1 : Math.max(row[j], next[j - 1]);
    }
    row = next;
  }
  return row[b.length];
}

function bag(text: string): Map<string, number> {
  const counts = new Map<string, number>();
  for (const char of text) counts.set(char, (counts.get(char) ?? 0) + 1);
  return counts;
}

/** The boxes without those inside another: a display's rows and its
 *  pieces come back beside the display, and flashing each drew the
 *  violet over itself several times. */
function outermost(boxes: PageBox[]): PageBox[] {
  const inside = (a: PageBox, b: PageBox) => a !== b && a.page === b.page
    && a.x >= b.x - SLACK && a.x + a.width <= b.x + b.width + SLACK
    && a.y - a.height >= b.y - b.height - SLACK && a.y <= b.y + SLACK;
  return boxes.filter((box) => !boxes.some((other) => inside(box, other)
    && !(inside(other, box) && boxes.indexOf(other) > boxes.indexOf(box))));
}

/** The nearest line at or around `line` that sets anything, and where on
 *  it the caret stands for, or nothing when the line is in the preamble.
 *
 *  The caret is often on a line TeX sets nothing from: one just made with
 *  Enter, an `\end{equation}`, a `\label`. SyncTeX answers those with
 *  whatever box it finds nearest in its own order, which was the first
 *  line of the page for a blank line under `\begin{document}`. The line
 *  above is the one just written, so it is tried first. */
export function settingLine(
  lines: string[],
  line: number,
  column: number,
): { line: number; column: number } | null {
  const begin = lines.findIndex((text) => /^[^%]*\\begin\s*\{document\}/.test(text));
  // In the preamble nothing on the page is this line's.
  if (begin >= 0 && line <= begin + 1) return null;
  const sets = (n: number) => n >= 1 && n <= lines.length && n > begin + 1
    && !/^[^%]*\\end\s*\{document\}/.test(lines[n - 1]) && project(lines[n - 1]).text.length > 0;
  if (sets(line)) return { line, column };
  for (let step = 1; step <= 12; step += 1) {
    if (sets(line - step)) return { line: line - step, column: lines[line - step - 1].length };
    if (sets(line + step)) return { line: line + step, column: 0 };
  }
  return { line, column };
}

/** The box a run of text stands in, when it stands in one. */
function boxOf(boxes: PageBox[], run: PageRun): PageBox | null {
  const middle = (run.top + run.bottom) / 2;
  const centre = run.left + run.width / 2;
  for (const box of boxes) {
    if (middle >= box.y - box.height - SLACK && middle <= box.y + SLACK
        && centre >= box.x - SLACK && centre <= box.x + box.width + SLACK) return box;
  }
  return null;
}

/** SyncTeX lists a line of type once for every node of it the source line
 *  made, so a paragraph line with three bits of maths comes back four
 *  times. */
function dedupe(boxes: PageBox[]): PageBox[] {
  const seen = new Map<string, PageBox>();
  for (const box of boxes) {
    const key = [box.page, box.x, box.y, box.width, box.height].map((n) => n.toFixed(2)).join(":");
    if (!seen.has(key)) seen.set(key, box);
  }
  return [...seen.values()];
}

const isLetter = (char: string | undefined) => char !== undefined && /[\p{L}\p{N}]/u.test(char);

const reverse = (text: string) => [...text].reverse().join("");
