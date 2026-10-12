/** Keeping the reader's place on the page when a build replaces it.
 *
 *  The preview kept its place across a rebuild as a page number and a
 *  fraction of that page, which is right only while every page holds what
 *  it held before. A writer whose edit pushes a line onto the next page
 *  moves everything after it down, and in a thesis written with `\include`
 *  the typing builds set only the chapter being written while the settling
 *  build after them sets the whole document, so page four of one was the
 *  front matter of the other. The view stayed on page four and lost the
 *  writing.
 *
 *  So the place is kept as text: the page's letters from the start of the
 *  line of type at the reader's eye, reduced the way `locate-word.ts`
 *  reduces them, and the distance from that line to the eye. Letters
 *  rather than the line itself, because a reflow changes which words
 *  share a line and keeps the letters in their order. The new document is
 *  searched near the page the reader was on and, when the page count says
 *  the document changed shape, everywhere.
 *
 *  Pure: the pages come in as runs, as `locate-on-page.ts` takes them.
 */

import { foldText } from "./locate-word";
import type { PageRun } from "./locate-on-page";

/** One way of saying where the reader is: the letters from the start of a
 *  line of type on, and that line's baseline in page points. */
export type Mark = { letters: string; baseline: number };

/** Where a mark was found again. */
export type Place = { page: number; baseline: number; mark: Mark };

/** How many letters a mark carries, and the fewest it may: fewer agree by
 *  chance across a thesis. */
const LETTERS = 48;
const FEWEST = 16;

/** How many pages either side of the expected one are read first. */
const NEAR = 3;

type Line = { baseline: number; top: number; first: number };

/** The page's letters in the order the page sets them, the run each came
 *  from, and the page's lines of type in that order with the first letter
 *  of each. */
function read(runs: PageRun[]): { text: string; lines: Line[] } {
  let text = "";
  const lines: Line[] = [];
  let last: Line | null = null;
  for (const run of runs) {
    const folded = foldText(run.str);
    if (!folded.length) continue;
    const size = Math.max(run.bottom - run.top, 1);
    if (!last || Math.abs(run.bottom - last.baseline) > size / 2) {
      last = { baseline: run.bottom, top: run.top, first: text.length };
      lines.push(last);
    } else {
      last.top = Math.min(last.top, run.top);
    }
    text += folded;
  }
  return { text, lines };
}

/** The marks for a reader whose eye is `y` points down this page, best
 *  first: the line at the eye, then the lines around it, so an edit on the
 *  very line being read still leaves its neighbours to be found. */
export function marksAt(runs: PageRun[], y: number): Mark[] {
  const { text, lines } = read(runs);
  if (!lines.length) return [];
  // The line the eye is on, or the nearest below it, or the last.
  let at = lines.findIndex((line) => line.baseline >= y);
  if (at < 0) at = lines.length - 1;
  const order = [0, 1, -1, 2, -2, 3, -3];
  const marks: Mark[] = [];
  for (const step of order) {
    const line = lines[at + step];
    if (!line) continue;
    const letters = text.slice(line.first, line.first + LETTERS);
    if (letters.length >= FEWEST) marks.push({ letters, baseline: line.baseline });
  }
  return marks;
}

/** The baselines on this page where `letters` starts. */
export function foundOn(runs: PageRun[], letters: string): number[] {
  let text = "";
  const baseline: number[] = [];
  for (const run of runs) {
    const folded = foldText(run.str);
    text += folded;
    for (let i = 0; i < folded.length; i += 1) baseline.push(run.bottom);
  }
  const found: number[] = [];
  for (let at = text.indexOf(letters); at >= 0; at = text.indexOf(letters, at + 1)) {
    found.push(baseline[at]);
  }
  return found;
}

/** Where the marks are in the new document, or nothing.
 *
 *  `expected` is the 1-based page the reader was on, and the pages around
 *  it are read first; a mark found on several is taken nearest it, since a
 *  repeated sentence is likelier repeated far away than beside itself.
 *  `everywhere` reads the rest of the document when the near pages do not
 *  have it, which is for a build that changed what the document is: a
 *  chapter alone where the whole thesis was, or the other way round. */
export async function findPlace(
  marks: Mark[],
  expected: number,
  count: number,
  runsOf: (page: number) => Promise<PageRun[] | null>,
  everywhere: boolean,
): Promise<Place | null> {
  if (!marks.length || count < 1) return null;
  const want = Math.min(Math.max(expected, 1), count);
  const near: number[] = [];
  for (let page = Math.max(1, want - NEAR); page <= Math.min(count, want + NEAR); page += 1) near.push(page);
  const search = async (pages: number[]) => {
    const texts = await Promise.all(pages.map((page) => runsOf(page)));
    for (const mark of marks) {
      let best: Place | null = null;
      pages.forEach((page, index) => {
        const runs = texts[index];
        if (!runs) return;
        const [first] = foundOn(runs, mark.letters);
        if (first === undefined) return;
        if (!best || Math.abs(page - want) < Math.abs(best.page - want)) best = { page, baseline: first, mark };
      });
      if (best) return best;
    }
    return null;
  };
  const close = await search(near);
  if (close || !everywhere) return close;
  const rest: number[] = [];
  for (let page = 1; page <= count; page += 1) if (!near.includes(page)) rest.push(page);
  return rest.length ? search(rest) : null;
}
