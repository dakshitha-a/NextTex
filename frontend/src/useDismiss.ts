import { useEffect, type RefObject } from "react";

/** Whether a press at `target` should close the panel.
 *
 *  Pulled out of the effect so it can be tested: the interesting case --
 *  a press on the trigger, which must be left to the trigger -- is three
 *  DOM nodes and no React at all. */
export function dismisses(
  panel: HTMLElement | null,
  anchor: HTMLElement | null | undefined,
  target: Node | null,
): boolean {
  if (!panel || !target) return false;
  if (panel.contains(target)) return false;
  // The trigger closes this itself, on click.  Closing here as well would
  // be the same gesture arriving twice, which reads as a menu that will
  // not shut.
  if (anchor?.contains(target)) return false;
  return true;
}

/** Close when the user looks away.
 *
 *  A menu that stays open until you click somewhere unrelated is a menu that
 *  follows you around the app, so a pointer press outside it closes it --
 *  in the capture phase, and on `pointerdown` rather than `click`, so that
 *  opening something else closes this first and it feels immediate.
 *
 *  That timing is why `anchor` exists. The press that closes the menu lands
 *  before the trigger's own `click` handler runs, so a trigger that toggles
 *  would close the menu here and reopen it a moment later -- the panel could
 *  never be dismissed by the button that opened it. Passing the trigger as
 *  `anchor` exempts it: the press is left alone and the trigger's `onClick`
 *  does the closing, which is what a toggle is supposed to do. */
export function useDismiss(
  ref: RefObject<HTMLElement | null>,
  open: boolean,
  close: () => void,
  anchor?: RefObject<HTMLElement | null>,
): void {
  useEffect(() => {
    if (!open) return;
    const away = (event: PointerEvent) => {
      if (dismisses(ref.current, anchor?.current, event.target as Node)) {
        close();
      }
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    window.addEventListener("pointerdown", away, true);
    window.addEventListener("keydown", escape);
    return () => {
      window.removeEventListener("pointerdown", away, true);
      window.removeEventListener("keydown", escape);
    };
  }, [ref, open, close, anchor]);
}
