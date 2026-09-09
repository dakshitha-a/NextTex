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

/** Everything inside `panel` that Tab would stop at, in Tab's own order. */
const TABBABLE = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(",");

export function tabbable(panel: HTMLElement | null): HTMLElement[] {
  if (!panel) return [];
  return Array.from(panel.querySelectorAll<HTMLElement>(TABBABLE)).filter(
    (item) => !item.hasAttribute("hidden") && item.getAttribute("aria-hidden") !== "true",
  );
}

/** Where Tab should land, given where it is now.
 *
 *  Pulled out for the same reason `dismisses` was: the interesting cases are
 *  the two ends of the list and a focus that has already escaped, and none of
 *  them needs React or a real key event to describe.
 *
 *  Returns null when Tab should be left alone, which is every press in the
 *  middle of a dialog.
 */
export function wraps(
  items: HTMLElement[],
  active: Element | null,
  backwards: boolean,
): HTMLElement | null {
  if (!items.length) return null;
  const first = items[0];
  const last = items[items.length - 1];
  const inside = active !== null && items.includes(active as HTMLElement);
  if (backwards) return !inside || active === first ? last : null;
  return !inside || active === last ? first : null;
}

/** Whether closing this panel should put the caret back where it was.
 *
 *  Not unconditionally, which is the mistake this encodes. Closing a menu is
 *  sometimes the act that moves focus somewhere new: the file tree's Rename
 *  item closes its menu and an inline input takes the caret in the same
 *  gesture. Restoring on the way out then took it straight back off again,
 *  and the rename was typed into nothing.
 *
 *  So it restores only when nobody else has claimed focus: the caret is
 *  still inside the panel being removed, or it has fallen to `body`, which
 *  is where it lands when the focused element is unmounted.
 */
export function restores(
  panel: HTMLElement | null,
  active: Element | null,
): boolean {
  if (!active || active === document.body) return true;
  return panel !== null && panel.contains(active);
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
      if (event.key !== "Escape") return;
      // Claimed, so that whatever is behind this popover does not also act
      // on the same keystroke.  Escape belongs to the innermost thing that
      // can be dismissed, and this is it while it is open.
      event.preventDefault();
      close();
    };
    window.addEventListener("pointerdown", away, true);
    window.addEventListener("keydown", escape);
    return () => {
      window.removeEventListener("pointerdown", away, true);
      window.removeEventListener("keydown", escape);
    };
  }, [ref, open, close, anchor]);

  // Focus is kept in its own effect, and deliberately not in the one above.
  // Every caller passes `close` as an inline arrow, so that effect tears
  // down and re-runs on every render while the panel is open. Registering
  // listeners twice is wasteful and harmless; moving focus twice a render
  // would be neither.
  useEffect(() => {
    if (!open) return;
    const panel = ref.current;
    // Only a dialog traps. A menu or a popover is not modal, and taking Tab
    // away from the page behind one would be a worse answer than the page
    // behind it receiving Tab.
    const modal = panel?.getAttribute("role") === "dialog";
    const returnTo = document.activeElement as HTMLElement | null;

    if (modal && panel && !panel.contains(document.activeElement)) {
      const first = tabbable(panel)[0];
      if (first) {
        first.focus();
      } else {
        // A dialog with nothing to focus still has to take the caret off
        // whatever is behind it, or the next key goes to the editor.
        if (!panel.hasAttribute("tabindex")) panel.setAttribute("tabindex", "-1");
        panel.focus();
      }
    }

    const keep = (event: KeyboardEvent) => {
      if (event.key !== "Tab" || !modal) return;
      const landing = wraps(tabbable(ref.current), document.activeElement, event.shiftKey);
      if (!landing) return;
      event.preventDefault();
      landing.focus();
    };
    window.addEventListener("keydown", keep);

    return () => {
      window.removeEventListener("keydown", keep);
      // Where the caret was before this opened. Without it, dismissing a
      // dialog left focus on `document.body`, so the next Tab started from
      // the top of the app rather than from the control that opened it.
      // `restores` is what stops it taking the caret back off whatever the
      // closing gesture just handed it to.
      if (restores(panel, document.activeElement) && returnTo?.isConnected) {
        returnTo.focus();
      }
    };
  }, [ref, open]);
}
