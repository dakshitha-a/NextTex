/** How tall the Claude column's composer box is: as tall as what is
 *  typed, so the writer can read the whole question back, until the
 *  composer card as a whole reaches half the column; from there the box
 *  keeps that height and scrolls. Never shorter than its two resting
 *  lines.
 *
 *  `content` is the box's scroll height with its height released,
 *  `rest` the rest of the card (chips, tools row, padding), `pane` the
 *  column's height and `floor` the box's resting height, all in the same
 *  CSS pixels. Pure, so the rule is tested without a browser. */
export function composerHeight(
  content: number,
  rest: number,
  pane: number,
  floor: number,
): { height: number; scrolls: boolean } {
  const cap = Math.max(floor, Math.floor(pane / 2) - rest);
  return { height: Math.max(floor, Math.min(content, cap)), scrolls: content > cap };
}
