/** The arithmetic that decides how wide the panes are.
 *
 *  Pulled out of the root component as functions rather than as a hook,
 *  deliberately.  Nothing in this repository renders a React component in a
 *  test, so a hook would move eleven pieces of state from one closure into
 *  another and produce no seam anybody could exercise.  These four take
 *  numbers and return numbers, which is the shape the rest of the frontend
 *  tests already have.
 *
 *  What they encode was previously inline, untested, and load bearing: it is
 *  what decides whether the row of panes fits the window or overflows it, and
 *  the shell clips rather than scrolls, so getting it wrong makes part of the
 *  interface unreachable rather than merely awkward.
 */

/** Rail and chat are pixel widths; `editor` is a fraction of the pair. */
export type Widths = { rail: number; editor: number; chat: number };

/** The pane minimums, in shell pixels.  The panes carry these in CSS too,
 *  and the drag has to know them or it computes ratios the layout cannot
 *  honour. */
export const MIN_EDITOR = 420;
export const MIN_PDF = 320;
export const MIN_RAIL = 180;
export const MIN_CHAT = 320;

/** The widths at which the arrangement changes.
 *
 *  Shell units rather than viewport pixels: the interface size is a `zoom`,
 *  so at 150 per cent a 1600 pixel window is a 1067 pixel shell and reaches
 *  these the way a smaller window would.
 */
export const BREAKPOINTS = {
  /** Below this the chat stops being a docked column and overlays instead. */
  narrow: 1400,
  /** Below this the file rail folds to a strip. */
  rail: 1100,
  /** Below this the source and the preview take turns rather than splitting
   *  a space too small for either. */
  tight: 900,
};

export function breakpoints(width: number): { narrow: boolean; tight: boolean } {
  return { narrow: width < BREAKPOINTS.narrow, tight: width < BREAKPOINTS.tight };
}

/** What the window can currently give the panes. */
export type Room = {
  width: number;
  tight: boolean;
  railShown: boolean;
  chatShown: boolean;
  /** The room the two middle panes refuse to go below, together. */
  minPair: number;
};

export function minPairFor(folded: { editor: boolean; pdf: boolean }): number {
  return (folded.editor ? 0 : MIN_EDITOR) + (folded.pdf ? 0 : MIN_PDF);
}

/** Fit the widths the writer chose into the window they actually have.
 *
 *  The chosen widths are kept, but the window may no longer be able to
 *  honour them: it has been made narrower, or they were restored from a
 *  session on a bigger screen.  The middle two panes will not go below their
 *  minimums, so without this the row overflows and the shell clips whatever
 *  is on the right.
 *
 *  Returns the same object when nothing has to move, and the caller relies on
 *  that: handing an identical object to the setter avoids a render.
 */
export function clampWidths(current: Widths, room: Room): Widths {
  if (room.tight) return current;
  const over =
    (room.railShown ? current.rail : 0) +
    (room.chatShown ? current.chat : 0) +
    room.minPair -
    room.width;
  if (over <= 0) return current;
  // Taken from the agent first and the file list second: the source and the
  // page are what is being looked at.
  const chat = room.chatShown
    ? Math.max(MIN_CHAT, current.chat - over)
    : current.chat;
  const left =
    (room.railShown ? current.rail : 0) +
    (room.chatShown ? chat : 0) +
    room.minPair -
    room.width;
  const rail =
    left > 0 && room.railShown
      ? Math.max(MIN_RAIL, current.rail - left)
      : current.rail;
  if (rail === current.rail && chat === current.chat) return current;
  return { ...current, rail, chat };
}

export type Divider = "rail" | "split" | "chat";

/** How far a divider may be dragged.
 *
 *  A side pane may only take the room the middle two can actually give up.
 *  That ceiling used to be a bare constant, so the chat could be dragged to
 *  560 against an editor and a page that together refuse to go below 740: the
 *  row overflowed, the shell clipped it, and the pane appeared to expand
 *  behind the preview rather than beside it.
 */
export function dragBounds(
  which: Divider,
  room: { pair: number; anchorWidth: number; minPair: number },
): { min: number; max: number } {
  if (which === "split") {
    return {
      min: MIN_EDITOR,
      max: Math.max(room.pair - MIN_PDF, MIN_EDITOR),
    };
  }
  const bounds =
    which === "rail" ? { min: MIN_RAIL, max: 400 } : { min: MIN_CHAT, max: 560 };
  const slack = Math.max(room.pair - room.minPair, 0);
  return {
    min: bounds.min,
    max: Math.max(Math.min(bounds.max, room.anchorWidth + slack), bounds.min),
  };
}

export type Folded = { rail: boolean; editor: boolean; pdf: boolean; chat: boolean };

/** Folding a pane, with the rule that one of the two middle panes stays open.
 *
 *  Otherwise a writer can fold the source and then the preview and be left
 *  looking at the shell's own background, with no obvious way back.
 */
export function nextFolded(current: Folded, pane: keyof Folded): Folded {
  const next = { ...current, [pane]: !current[pane] };
  if (pane === "editor" && next.editor) next.pdf = false;
  if (pane === "pdf" && next.pdf) next.editor = false;
  return next;
}
