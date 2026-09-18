/** The image viewer's two numbers: how far to shrink a picture so all of
 *  it is in the frame, and which zoom comes next.
 *
 *  Pure, and beside `FileView.tsx` rather than inside it, so the vitest
 *  can hold them without mounting React or the API client.
 */

/** The zoom ladder, and it is the preview pane's, deliberately.  Two
 *  viewers a keystroke apart that step through different numbers would be
 *  two viewers; these are meant to be one thing that can show two kinds of
 *  file. */
export const STEPS = [0.25, 0.5, 0.75, 1, 1.5, 2, 3];

/** The next rung strictly past `from`, or `from` itself when there is
 *  none in that direction.
 *
 *  Strictly past, because the place this starts from is usually not a
 *  rung: it is whatever scale fits the frame.  Rounding to the nearest
 *  rung first meant `-` from a fit just above a rung did nothing the
 *  first time, and `+` from a fit just below one skipped a rung. */
export function nextStep(from: number, by: 1 | -1): number {
  if (by === 1) return STEPS.find((step) => step > from + 1e-6) ?? from;
  const below = STEPS.filter((step) => step < from - 1e-6);
  return below.length ? below[below.length - 1] : from;
}

/** The room the frame leaves around a fitted image, on each side: the
 *  frame's own `p-5`, plus the hairline `.nx-page` draws round the
 *  picture, which is outside the image's own box and was the two pixels
 *  by which a fitted figure still scrolled. */
export const FRAME_PADDING = 20 + 1;

/** The scale at which the whole image is inside the frame.
 *
 *  This used to be CSS: `max-width: 100%; max-height: 100%` on the `img`.
 *  Both percentages resolve against the `.nx-page` wrapper, which is
 *  `shrink-0` with auto width and height, so they resolved against the
 *  image's own size and a 7000px plot was drawn at 7000px inside a 489px
 *  frame.  Fit did nothing for exactly the images it exists for.  A number
 *  computed from the frame cannot be undone by a wrapper, and it is also
 *  what the ladder needs: `+` from Fit steps from the fit, not from 1.
 *
 *  Capped at 1: a 300px figure is not blown up to the pane, since the
 *  first question about a figure is whether it is right, and a figure
 *  judged at three times its size is not the figure. */
export function fitScale(
  frame: { width: number; height: number },
  natural: { w: number; h: number },
  padding = FRAME_PADDING,
): number {
  const width = Math.max(1, frame.width - padding * 2);
  const height = Math.max(1, frame.height - padding * 2);
  return Math.min(1, width / natural.w, height / natural.h);
}
