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
  if (left.length + right.length < LEAST) return outermost(unique);

  let best: { box: PageBox; score: number } | null = null;
  for (const page of [...new Set(unique.map((box) => box.page))]) {
    const runs = await text(page);
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
  if (!best || best.score < Math.min(LEAST, available / 2)) return outermost(unique);
  return [best.box];
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
