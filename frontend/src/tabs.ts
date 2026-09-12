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

/** The tab one step along the strip, wrapping at both ends.
 *
 *  Wrapping rather than stopping, because the strip is a ring in the way a
 *  writer uses it: two or three files, gone round and round. Stopping at
 *  the end would make the second press of a repeated key do nothing, which
 *  reads as the key having failed.
 */
export function neighbour(
  tabs: Tab[],
  activePath: string | null,
  step: 1 | -1,
): string | null {
  if (tabs.length === 0) return null;
  const at = tabs.findIndex((tab) => tab.path === activePath);
  // A strip with nothing in front, which happens after closing the last
  // tab: the first press goes to an end rather than to nowhere.
  if (at === -1) return step === 1 ? tabs[0].path : tabs[tabs.length - 1].path;
  return tabs[(at + step + tabs.length) % tabs.length].path;
}

/** The most recently closed tabs, newest last, capped.
 *
 *  Capped because this is a convenience and not a history: a session that
 *  opens and closes two hundred files should not carry two hundred paths
 *  around, and nobody reopens the two hundredth.
 */
export const CLOSED_CAP = 20;

export function pushClosed(stack: string[], paths: string[]): string[] {
  // A path closed twice is remembered once, at its newest position:
  // reopening it, closing it again and pressing reopen should give it
  // back rather than give it back and then give it back again.
  const next = stack.filter((path) => !paths.includes(path)).concat(paths);
  return next.slice(-CLOSED_CAP);
}
