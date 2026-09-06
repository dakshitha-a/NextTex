/** Measuring a zoomed interface.
 *
 *  The interface size is a `zoom` on `#root`, and `zoom` leaves the app
 *  straddling two coordinate spaces.  Measured in Chrome at 150% rather
 *  than reasoned about, because the two halves are not symmetrical:
 *
 *  - **Reads are in viewport pixels.**  `getBoundingClientRect()` on an
 *    element inside the zoomed subtree reports 900 for something whose own
 *    `left` is 600px.  `MouseEvent.clientX` and `window.innerWidth` agree
 *    with it.  So reads can be compared with each other safely.
 *  - **Writes are in zoomed pixels.**  Setting `style.left = "600px"` on a
 *    fixed element inside the subtree puts it at viewport 900.
 *
 *  So the bug is never in the reading.  It is in taking a number that was
 *  read -- a pointer position, a viewport width -- and either writing it
 *  back as a style, or comparing it against a literal from the stylesheet.
 *  Both of those live in zoomed space, and both need `toShell`.
 */

export function uiScale(): number {
  const value = Number(
    getComputedStyle(document.documentElement).getPropertyValue("--nx-ui-scale"),
  );
  return value > 0 ? value : 1;
}

/** A viewport measurement, converted into the space the layout is laid out
 *  in.  At 150% on a 1680px display the app has 1120px to arrange. */
export function toShell(pixels: number): number {
  return pixels / uiScale();
}

export function viewportWidth(): number {
  return toShell(window.innerWidth);
}

export function viewportHeight(): number {
  return toShell(window.innerHeight);
}
