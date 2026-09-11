import type { Tab } from "./store";

/** What a bulk close leaves behind.
 *
 *  Pulled out of the callback that performs it for the reason `dismisses`
 *  and `wraps` are pulled out of `useDismiss`: the interesting cases are a
 *  strip of one, a target that is no longer in the strip, and a tab in
 *  front that is not the tab the menu was opened on, and none of them needs
 *  React, a store or an editor to describe.
 *
 *  `closed` is the list the editor has to release, and it is the answer to
 *  "is there anything to do at all": a caller with nothing in it must not
 *  touch the store, or every no-op menu click would redraw the strip and
 *  write the session out again.
 */
export function afterClosing(
  tabs: Tab[],
  activePath: string | null,
  what: "others" | "all",
  target: string,
): { tabs: Tab[]; activePath: string | null; closed: string[] } {
  // A menu can outlive the tab it was opened on: the file is renamed
  // underneath it, or another window closes it. Closing "the others" from a
  // tab that is no longer there would close the whole strip, which is the
  // opposite of what was asked for.
  if (what === "others" && !tabs.some((tab) => tab.path === target)) {
    return { tabs, activePath, closed: [] };
  }
  const kept = what === "all" ? [] : tabs.filter((tab) => tab.path === target);
  const closed = tabs
    .filter((tab) => !kept.some((keep) => keep.path === tab.path))
    .map((tab) => tab.path);
  return {
    tabs: kept,
    // The tab the gesture landed on ends up in front, which matters when it
    // was not the one in front to begin with.
    activePath: what === "all" ? null : target,
    closed,
  };
}

/** Whether a bulk close would take the file being viewed historically with
 *  it.  A text file parks its own buffer and comes back to now when the
 *  editor releases it; a figure has no buffer, so `viewing` is set and
 *  cleared by the app and nothing else would notice. */
export function viewingClosed(
  viewing: { path: string } | null,
  closed: string[],
): boolean {
  return viewing !== null && closed.includes(viewing.path);
}
