/** From a place on the rendered Markdown to a line of its source.
 *
 *  The page has SyncTeX for this and a round trip to the server; the
 *  Markdown pane has the parser, which read the file's lines itself and
 *  kept the first line of every block.  What is left to work out is which
 *  line of a block that spans several the click landed on, and the word
 *  the second click of a double-click selected is what says: it is on
 *  exactly one of the block's own lines, usually.  The editor then finds
 *  its column with `locateWord`, the way it does after a SyncTeX answer.
 */

import { normaliseWord } from "./locate-word";
import { same, type Block } from "./prose";

/** The source line the word sits on inside the block: the first of the
 *  block's lines that has it as a whole word, or the block's first line
 *  of text when nothing does, which is what a click on a bullet, on
 *  punctuation, or on a word the parser rewrote gets. */
export function lineOf(block: Block, word: string): number {
  const clean = normaliseWord(word);
  // A list item is one line; the block's line is its first item's, and
  // the item that was clicked is decided by the caller from its `<li>`.
  const first = block.kind === "code" ? block.line + 1 : block.line;
  if (!clean || block.kind === "list") return first;
  const pattern = new RegExp(
    `(?<![\\p{L}\\p{N}])${clean.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\p{L}\\p{N}])`,
    "iu",
  );
  const lines = block.text.split("\n");
  for (let index = 0; index < lines.length; index += 1) {
    if (pattern.test(lines[index])) return first + index;
  }
  return first;
}

/** `same`, and the lines too.  The pane writes each block's line into
 *  the DOM, so a block whose text is unchanged but which moved down a
 *  line when a paragraph was inserted above it has to be drawn again or
 *  its double-click would name the old line. */
export function sameWithLines(
  before: { block: Block },
  after: { block: Block },
): boolean {
  if (!same(before, after)) return false;
  const one = before.block;
  const two = after.block;
  if (one.line !== two.line) return false;
  if (one.kind === "list" && two.kind === "list") {
    return one.lines.every((line, at) => line === two.lines[at]);
  }
  return true;
}
