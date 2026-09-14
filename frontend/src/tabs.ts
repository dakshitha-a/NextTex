import type { Diagnostic } from "./api";
import type { DocBuild, Tab } from "./store";

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

/** The open files that belonged to documents no longer on the strip.
 *
 *  Closing a preview closes the files of that document: the chapter that
 *  brought it there, its own root file, a `.bib` only it reads.  `owners`
 *  is the server's file-to-documents map as it stood *before* the removal,
 *  because the answer to the removal no longer mentions the document that
 *  went; `remaining` is the strip after it.  A file with an owner still on
 *  the strip stays, so a block shared between two variants of a resume is
 *  not taken away by closing one of them, and a file with no owner at all
 *  stays too: a scratch file, a figure, a chapter `\input` seconds ago that
 *  the graph has not caught up with.  Closing what is not known to belong
 *  to anything is how a writer loses their place.
 */
export function orphanedBy(
  tabs: Tab[],
  owners: Record<string, string[]>,
  remaining: string[],
): string[] {
  return tabs
    .map((tab) => tab.path)
    .filter((path) => {
      const readers = owners[path] ?? [];
      return readers.length > 0 && !readers.some((document) => remaining.includes(document));
    });
}

/** The documents this window followed onto the strip whose last open file
 *  has just gone.
 *
 *  `followed` is what this window put on the strip because a file of it was
 *  opened, and nothing the writer asked for by name: a document added with
 *  `+`, restored from `previews.json`, or clicked on the strip is not in it.
 *  Such a document may leave when its files do, since it arrived the same
 *  way.  The strip cannot be emptied, so when every document on it would go
 *  the one in front stays, or the first if nothing is in front.
 */
export function unfollowed(
  followed: Iterable<string>,
  previews: string[],
  activePreview: string | null,
  tabs: Tab[],
  owners: Record<string, string[]>,
): string[] {
  const held = new Set<string>();
  for (const tab of tabs) for (const document of owners[tab.path] ?? []) held.add(document);
  const going = [...followed].filter(
    (document) => previews.includes(document) && !held.has(document),
  );
  if (going.length && going.length >= previews.length) {
    const keep = activePreview && going.includes(activePreview) ? activePreview : going[0];
    return going.filter((document) => document !== keep);
  }
  return going;
}

/** Where a path is after `from` became `to`, or null if it did not move.
 *
 *  A folder that moves takes every file under it, so this follows a path
 *  prefix rather than an exact match.  Matching only the moved path itself
 *  left every tab inside a moved folder pointing at a file that was no
 *  longer there, and the next save wrote it back to the old place.
 */
export function movedPath(path: string, from: string, to: string): string | null {
  if (path === from) return to;
  if (path.startsWith(`${from}/`)) return `${to}${path.slice(from.length)}`;
  return null;
}

/** Everything in the store that names a path, after a rename.
 *
 *  One function for the two callers, the route's `renamed` event and the
 *  `renamed` map a `previews_changed` carries, so the prefix rule exists
 *  once.  The second caller is why the strip's fields are here too: the
 *  tabs and the strip have to move in one store write, because the effect
 *  that makes the page follow the file runs on either changing and, with
 *  the strip moved and the tab still under its old name, asked the server
 *  to preview a file that no longer existed.  `touched` says whether
 *  anything moved, so a caller with nothing to do does not write the
 *  store and redraw both strips.
 */
export function renamePaths(
  state: {
    tabs: Tab[];
    activePath: string | null;
    viewing: { path: string } | null;
    previews: string[];
    activePreview: string;
    builds: Record<string, DocBuild>;
    diagnosticsByDoc: Record<string, Diagnostic[]>;
  },
  renamed: Record<string, string>,
): {
  touched: boolean;
  tabs: Tab[];
  activePath: string | null;
  viewing: typeof state.viewing;
  previews: string[];
  activePreview: string;
  builds: Record<string, DocBuild>;
  diagnosticsByDoc: Record<string, Diagnostic[]>;
} {
  const moved = (path: string): string | null => {
    for (const [from, to] of Object.entries(renamed)) {
      const next = movedPath(path, from, to);
      if (next !== null) return next;
    }
    return null;
  };
  let touched = false;
  const follow = (path: string): string => {
    const next = moved(path);
    if (next === null) return path;
    touched = true;
    return next;
  };
  const rekey = <T,>(record: Record<string, T>): Record<string, T> => {
    const out: Record<string, T> = {};
    for (const [key, value] of Object.entries(record)) out[follow(key)] = value;
    return out;
  };
  const tabs = state.tabs.map((tab) => {
    const next = moved(tab.path);
    if (next === null) return tab;
    touched = true;
    return { ...tab, path: next };
  });
  const activePath = state.activePath === null ? null : follow(state.activePath);
  const viewing = state.viewing ? { ...state.viewing, path: follow(state.viewing.path) } : null;
  const previews = state.previews.map(follow);
  const activePreview = state.activePreview ? follow(state.activePreview) : state.activePreview;
  const builds = rekey(state.builds);
  const diagnosticsByDoc = rekey(state.diagnosticsByDoc);
  return {
    touched, tabs, activePath, viewing, previews, activePreview, builds, diagnosticsByDoc,
  };
}
