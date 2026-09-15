/** Where the row of selection verbs goes, so that it covers no selected
 *  text.
 *
 *  Above the first selected line by preference.  It used to be placed
 *  thirty pixels above that line and clamped to the top of the pane when
 *  there was no room, and both halves were wrong: the row is taller than
 *  thirty pixels, so its bottom edge sat on the first line even with room
 *  to spare, and the clamp put it squarely over the first line whenever a
 *  selection started near the top of the view, which a selection made
 *  after scrolling to a paragraph usually does.  Now the row's own height
 *  is measured, and when there is no room above the first line it goes
 *  below the last one, and only when the last one is off the bottom of
 *  the view does it sit at the foot of the pane, over whichever line is
 *  there, which is the one case with no clear ground.
 *
 *  A "line" here is a line block: the whole logical line, every visual
 *  row of a wrapped paragraph and its leading, as `EditorView.lineBlockAt`
 *  reports it.  The boxes were the glyph rectangles of the first and last
 *  selected characters once, and on a paragraph wrapped over four rows a
 *  selection on the third row put the row over the second, which is the
 *  same line and the text the row is about.  Clear of the block means
 *  over the blank line before the paragraph or after it.
 */

export type Box = { top: number; bottom: number; left: number };

export function placeVerbRow(
  /** The first selected line's block, in pane coordinates. */
  first: Box,
  /** The last selected line's block, in pane coordinates; the same as
   *  `first` for a selection inside one line. */
  last: Box,
  pane: { width: number; height: number },
  row: { width: number; height: number },
  gap = 4,
): { left: number; top: number } {
  const left = Math.max(8, Math.min(first.left, pane.width - row.width - 8));
  const above = first.top - gap - row.height;
  if (above >= 4) return { left, top: above };
  const below = last.bottom + gap;
  if (below + row.height <= pane.height - 4) return { left, top: below };
  return { left, top: Math.max(4, pane.height - row.height - 8) };
}
