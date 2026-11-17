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
  // A list's items are found by `itemLineOf`, from the `<li>` that was
  // clicked, and a table's rows are their own `<tr>`'s.
  const first = block.kind === "code" ? block.line + 1 : block.line;
  if (block.kind === "list" || block.kind === "table") return first;
  return wordLine(block.text, first, word);
}

/** The source line of a word inside a list item, given the item's own
 *  first line from its `<li>`: an item's text keeps one line per source
 *  line, so the word's line in it counts down from there. */
export function itemLineOf(blocks: Block[], line: number, word: string): number {
  for (const block of everyBlock(blocks)) {
    if (block.kind !== "list") continue;
    const at = block.lines.indexOf(line);
    if (at >= 0) return wordLine(block.items[at], line, word);
  }
  return line;
}

/** The block a double-click on an element other than a list item or a
 *  table row landed in, by the line in its `data-line`, looking inside
 *  list items too.  A list is passed over: an item's first block starts
 *  on the item's line, and the click was on that block. */
export function blockAt(blocks: Block[], line: number): Block | undefined {
  return everyBlock(blocks).find((block) => block.line === line && block.kind !== "list");
}

/** Every block, with the blocks inside list items after their list. */
function everyBlock(blocks: Block[]): Block[] {
  return blocks.flatMap((block) =>
    block.kind === "list" ? [block, ...block.parts.flatMap(everyBlock)] : [block],
  );
}

function wordLine(text: string, first: number, word: string): number {
  const clean = normaliseWord(word);
  if (!clean) return first;
  const pattern = new RegExp(
    `(?<![\\p{L}\\p{N}])${clean.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\p{L}\\p{N}])`,
    "iu",
  );
  const lines = text.split("\n");
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
  if ((one.kind === "list" && two.kind === "list") || (one.kind === "table" && two.kind === "table")) {
    return one.lines.every((line, at) => line === two.lines[at]);
  }
  return true;
}
