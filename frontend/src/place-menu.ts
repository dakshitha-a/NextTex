import { useLayoutEffect, useState, type RefObject } from "react";
import { viewportHeight, viewportWidth } from "./viewport";

/** Where a menu wants to be, before the screen has had its say.
 *
 *  `left` and `top` are the corner it would take with room to spare:
 *  under its button, or at the pointer.  `flip` is the bottom edge it may
 *  take instead when there is no room below, which for a button is the
 *  button's top and for a pointer is the pointer itself.  All in the
 *  shell's own pixels, converted with `toShell` by whoever read them. */
export type Wanted = { left: number; top: number; flip?: number };

export type Size = { width: number; height: number };

/** Keep a menu on the screen.
 *
 *  The tree's row menu was placed at `min(button.bottom + 4, viewport - 220)`
 *  and the tab menu at `min(pointer, viewport - 120)`: each a guess at
 *  its own height, and each wrong as soon as the menu grew.  A `.tex`
 *  row's menu is 306px tall, the history-deletion question inside it
 *  makes it taller, and on a row near the foot of a short window the last
 *  items were below the screen with no way to reach them.
 *
 *  So the height is measured rather than guessed, by `useOnScreen` below
 *  once the menu is in the DOM, and this decides: below the anchor when
 *  the whole menu fits there; above it when it fits there instead; and
 *  otherwise as low as it can go with its bottom edge inside the window,
 *  which is the case of a window shorter than the menu, where the caller
 *  also lets it scroll.  The same on the horizontal axis, without the flip:
 *  a menu is pushed left until its right edge is inside.  Pure, so the
 *  four cases are a vitest rather than four windows. */
export function placeMenu(
  wanted: Wanted,
  size: Size,
  viewport: Size,
  margin = 8,
): { left: number; top: number } {
  const left = Math.max(margin, Math.min(wanted.left, viewport.width - size.width - margin));
  const lowest = viewport.height - size.height - margin;
  let top: number;
  if (wanted.top <= lowest) top = wanted.top;
  else if (wanted.flip !== undefined && wanted.flip - size.height >= margin) top = wanted.flip - size.height;
  else top = Math.max(margin, lowest);
  return { left, top };
}

/** The corner a mounted menu should take, measured after it is drawn.
 *
 *  A layout effect, so the menu is moved before the frame is painted and
 *  never seen in the wrong place.  `revision` is anything whose change
 *  changes the menu's height, such as the question the tree's menu can
 *  open inside itself; the measurement runs again when it changes.  Null
 *  until there is something to measure, and the caller draws at `wanted`
 *  until then, which is the same frame. */
export function useOnScreen(
  ref: RefObject<HTMLElement | null>,
  wanted: Wanted | null,
  revision?: unknown,
): { left: number; top: number } | null {
  const [placed, setPlaced] = useState<{ left: number; top: number } | null>(null);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!wanted || !element) {
      setPlaced(null);
      return;
    }
    // `offsetWidth` and `offsetHeight` are in the element's own pixels,
    // which inside the zoomed shell are the shell's, so nothing here
    // crosses the two coordinate spaces `viewport.ts` describes.
    const next = placeMenu(
      wanted,
      { width: element.offsetWidth, height: element.offsetHeight },
      { width: viewportWidth(), height: viewportHeight() },
    );
    setPlaced((current) =>
      current && current.left === next.left && current.top === next.top ? current : next,
    );
  }, [ref, wanted, revision]);
  return placed;
}
