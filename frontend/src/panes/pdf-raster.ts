/** How many device pixels a preview page is drawn with, and how big a canvas
 *  that is allowed to be.
 *
 *  Its own module beside the pane, like `pdf-absence.ts`, because both
 *  answers are arithmetic with no browser in them and this repository tests
 *  extracted helpers rather than rendering components.  The pane reads the
 *  device ratio, the interface scale and the writer's choice, and asks here.
 *
 *  The reason this exists at all is that the CSS box and the backing store
 *  used to be worked out in two places, from two separately floored
 *  viewports, so the real ratio between them was only approximately the one
 *  intended.  Fit-width almost always lands on a fractional scale, which
 *  made that the common case rather than an edge one: every page was being
 *  resampled by a factor near but not equal to one, which is exactly what
 *  soft text looks like.  Both numbers come from one function now, computed
 *  from one floored box, so they cannot drift apart again.
 */

/** What the writer asked for: fewer pixels and less work, or more of both. */
export type PreviewQuality = "faster" | "balanced" | "sharper";

export const QUALITIES: PreviewQuality[] = ["faster", "balanced", "sharper"];

/** The most pixels one page may be drawn with.
 *
 *  A canvas is not free memory: a browser refuses an allocation past its own
 *  limit and paints nothing at all, with no error worth the name.  A4 at the
 *  maximum zoom of 3 on a retina screen is around eighteen megapixels, and
 *  the old ceiling of 3 combined with that zoom could ask for thirty-nine, so
 *  this bites where it should.  It matters most away from a desktop: a tablet
 *  browser allocates far less, and this app is now meant to be readable on
 *  one.
 *
 *  Sixteen megapixels is roughly A4 at 300 dpi, which is more resolution than
 *  a screen can show and about as much as is worth holding for one page.
 */
export const MAX_CANVAS_AREA = 16_000_000;

/** Device pixels per CSS pixel for the page raster.
 *
 *  Takes its inputs rather than reading the window, so it can be tested.
 *  `balanced` is exactly what this pane did before the setting existed, so
 *  an install that never opens the control sees no change at all.
 *
 *  At a device ratio of 1, `faster` and `balanced` are the same number, and
 *  that is not an oversight: there is no way to draw fewer pixels than the
 *  CSS box without blurring the page on purpose. `faster` is a ceiling for
 *  retina screens and for a scaled-up interface, which is where the work
 *  actually is.
 */
export function resolutionFor(
  dpr: number,
  ui: number,
  quality: PreviewQuality,
): number {
  const natural = (dpr || 1) * (ui || 1);
  if (quality === "faster") return Math.min(natural, 1.5);
  if (quality === "sharper") return Math.min(natural * 1.5, 4);
  return Math.min(natural, 3);
}

export type Backing = {
  /** The canvas backing store, in device pixels. */
  width: number;
  height: number;
  /** The ratio actually used, which is the asked-for one unless the area
   *  guard reduced it.  The pdf.js viewport is built from this. */
  ratio: number;
};

/** The backing store for a page whose CSS box is `cssWidth` by `cssHeight`.
 *
 *  The box is floored once, here, and the store is derived from that same
 *  floored box, so `width / cssWidth` really is `ratio` rather than
 *  approximately it.
 *
 *  When the area guard bites it reduces the ratio and never the box: a page
 *  that will not fit at full resolution should be slightly soft, not
 *  slightly the wrong size on the screen.
 */
export function backingFor(
  cssWidth: number,
  cssHeight: number,
  ratio: number,
  maxArea: number = MAX_CANVAS_AREA,
): Backing {
  const boxWidth = Math.max(1, Math.floor(cssWidth));
  const boxHeight = Math.max(1, Math.floor(cssHeight));
  const asked = Math.max(0.1, ratio || 1);
  const area = boxWidth * boxHeight * asked * asked;
  const allowed =
    area > maxArea && maxArea > 0
      ? Math.max(0.1, Math.sqrt(maxArea / (boxWidth * boxHeight)))
      : asked;
  return {
    width: Math.max(1, Math.floor(boxWidth * allowed)),
    height: Math.max(1, Math.floor(boxHeight * allowed)),
    ratio: allowed,
  };
}

/** Whether two rasters were drawn for the same conditions.
 *
 *  Rounded, because a device ratio is a float and a redraw on the eighth
 *  decimal place is a redraw for nothing.
 */
export function rasterKey(ratio: number): number {
  return Math.round(ratio * 1000) / 1000;
}

/** A two finger pinch, in the units the wheel path already speaks.
 *
 *  `apply` turns a delta into a scale with `exp(-delta * 0.002)`, so a
 *  distance ratio becomes a delta by taking its logarithm and undoing that
 *  constant.  Converting here rather than at the touch handler means the
 *  limits, the frame coalescing, the redraw rationing and the commit are all
 *  the ones the trackpad already goes through, which is the whole point of
 *  feeding the same path instead of writing a second one.
 */
export function pinchDelta(from: number, to: number): number {
  if (!(from > 0) || !(to > 0)) return 0;
  return -Math.log(to / from) / 0.002;
}
