/** Where a thing that floats over the editor about a piece of its text
 *  goes, so that it covers none of that text.
 *
 *  One rule for the row of selection verbs and for the hover cards, in
 *  one function: clear of the block, nearest the pointer, inside the
 *  pane.  Above the block's first line by preference; below its last
 *  line when there is no room above; and only when the block fills the
 *  view, so that neither is clear, at the edge of the pane nearest the
 *  pointer, over whichever line is there, which is the one case with no
 *  clear ground.  Sideways the left edge sits at the text it is about
 *  and is clamped inside the pane.
 *
 *  The verb row used to be placed thirty pixels above the first selected
 *  line and clamped to the top of the pane when there was no room, and
 *  both halves were wrong: the row is taller than thirty pixels, so its
 *  bottom edge sat on the first line even with room to spare, and the
 *  clamp put it squarely over the first line whenever a selection started
 *  near the top of the view, which a selection made after scrolling to a
 *  paragraph usually does.  The hover cards had CodeMirror's own
 *  placement, which anchors on the first line of the hovered range and,
 *  when there is no room above, pins the card to the top of the view over
 *  the range's own lines.  Both now come through here.
 *
 *  A "line" is a line block: the whole logical line, every visual row of
 *  a wrapped paragraph and its leading, as `EditorView.lineBlockAt`
 *  reports it.  The boxes were the glyph rectangles of the first and last
 *  selected characters once, and on a paragraph wrapped over four rows a
 *  selection on the third row put the row over the second, which is the
 *  same line and the text the row is about.  Clear of the block means
 *  over the blank line before the paragraph or after it.
 *
 *  Everything here is in one space, pane pixels as the pane is laid out:
 *  shell pixels, not viewport ones.  The interface size setting scales
 *  the shell with `zoom`, so a viewport measurement is the shell's times
 *  the scale, and a caller that hands a viewport number to this and
 *  writes the answer as CSS pixels draws the thing that much further
 *  right and down: over the text at 110 %, off the pane at 125 %.  That
 *  was the verb row for as long as the interface size existed.
 */

export type Box = { top: number; bottom: number; left: number };

export type Placed = {
  left: number;
  top: number;
  /** Which side of the text the thing sits on.  At a pane edge it is the
   *  side the text is on from there, so a card at the top edge is
   *  `above` the text under it. */
  side: "above" | "below";
};

export function placeClear(
  /** The block's first line, in pane pixels. */
  first: Box,
  /** The block's last line, in pane pixels; the same as `first` for a
   *  block of one line. */
  last: Box,
  pane: { width: number; height: number },
  size: { width: number; height: number },
  /** Where the pointer is, in pane pixels, for the one case with no
   *  clear ground.  Omitted, the foot of the pane. */
  pointerY?: number,
  gap = 4,
): Placed {
  const left = Math.max(8, Math.min(first.left, pane.width - size.width - 8));
  const above = first.top - gap - size.height;
  if (above >= 4) return { left, top: above, side: "above" };
  const below = last.bottom + gap;
  if (below + size.height <= pane.height - 4) return { left, top: below, side: "below" };
  if (pointerY !== undefined && pointerY < pane.height / 2) {
    return { left, top: 4, side: "above" };
  }
  return { left, top: Math.max(4, pane.height - size.height - 8), side: "below" };
}
