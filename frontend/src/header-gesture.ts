/** One header, two gestures, and the arithmetic that tells them apart.
 *
 *  A click on a pane's header folds the pane; a double-click gives the pane
 *  the window.  A double-click arrives as two clicks, so the fold has to
 *  wait to find out which one it is: `DOUBLE_CLICK_MS` is the shortest wait
 *  that does not turn a deliberate double-click into a fold followed by a
 *  mode, and short enough that a single click still feels like a button.
 *
 *  The handle is the tab in front as well as the empty run of the strip,
 *  because a writer with a dozen files open has no empty run left.  That
 *  adds one trap: a double-click on a tab that is *not* in front is click
 *  one selecting it and click two landing on a tab that now is, and without
 *  a guard the pane folds under a writer who only meant to switch.  So a
 *  selection is recorded, and a header click that follows one within the
 *  same window is the second half of that double-click and is ignored.
 */

export const DOUBLE_CLICK_MS = 250;

export type Pane = "editor" | "pdf";

/** The fold that is waiting to find out whether it was a double-click. */
export type Pending = { pane: Pane; at: number };

export type Verdict =
  /** Start the wait; fold this pane when it runs out. */
  | { kind: "arm" }
  /** The second click of a double-click on the same header: the mode. */
  | { kind: "mode" }
  /** A click on the other header while one was waiting: the first was a
   *  single click on its own, so fold it now and start waiting for this. */
  | { kind: "fold-then-arm"; fold: Pane }
  /** The second half of a double-click that selected a tab; nothing. */
  | { kind: "ignore" };

export function headerClick(
  pending: Pending | null,
  /** When a tab on this header was last selected, or null. */
  selectedAt: number | null,
  pane: Pane,
  now: number,
): Verdict {
  if (selectedAt !== null && now - selectedAt < DOUBLE_CLICK_MS) {
    return { kind: "ignore" };
  }
  if (pending && now - pending.at < DOUBLE_CLICK_MS) {
    if (pending.pane === pane) return { kind: "mode" };
    return { kind: "fold-then-arm", fold: pending.pane };
  }
  return { kind: "arm" };
}
