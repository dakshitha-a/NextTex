/** The locator under test, behind one shape the census can call.
 *
 *  Swapped when the locator changes; the census does not. */

import { locateWord } from "../../frontend/src/panes/locate-word";
import { wordAt } from "../../frontend/src/panes/pdf-click";

export type Span = { text: string; eol: boolean };

/** Everything a double-click on the page knows: the page's spans, which
 *  one the pointer is in and where in it. */
export type Click = {
  word: string;
  page: number;
  spans: Span[];
  span: number;
  offset: number;
};

/** Where it landed: a 1-based line and 0-based columns. */
export type Landing = { line: number; from: number; to: number };

export function locate(lines: string[], near: number, click: Click): Landing | null {
  // The text layer as Pdf.tsx reads it: each span, and a break after the
  // last span of a line.
  const pieces: string[] = [];
  let piece = 0;
  click.spans.forEach((span, index) => {
    if (index === click.span) piece = pieces.length;
    pieces.push(span.text);
    if (span.eol) pieces.push("\n");
  });
  const hint = wordAt(pieces, piece, click.offset);
  return locateWord((at) => lines[at - 1], lines.length, near, hint);
}
