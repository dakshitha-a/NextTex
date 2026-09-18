/** Whether a project row matches what was typed into the filter.
 *
 *  Every word typed has to appear somewhere in the name or the path,
 *  case regardless, so `thesis 2027` finds the one thesis folder with
 *  that year in it and nothing typed matches everything.  Substrings, not
 *  fuzzy matching: a dozen rows is a list a person can read, and the
 *  filter is there to shorten it, not to guess. */
export function matches(
  project: { name: string; path: string },
  query: string,
): boolean {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const haystack = `${project.name}\n${project.path}`.toLowerCase();
  return words.every((word) => haystack.includes(word));
}

/** Six projects is where the list stops being something the eye takes in
 *  at once: it is when the filter appears and, on a wide enough window,
 *  when the ways in move beside the list rather than under it. One
 *  number, one rule. */
export const LONG_LIST = 6;

/** How the list is ordered.  `recent` is the order the server already
 *  answers in, most recently opened first (`Registry.list` in
 *  `nexttex/project.py`); `name` is alphabetical. */
export type SortKey = "recent" | "name";
export const SORT_KEYS: readonly SortKey[] = ["recent", "name"];

/** Where the choice is kept, per browser, beside the appearance keys. */
export const SORT_STORAGE = "nexttex.projects.sort";

/** A stored or hand-edited value to a key.  Anything that is not the one
 *  other choice is the default, so an older or garbled value cannot leave
 *  the list in no order at all. */
export function sortKeyFrom(raw: string | null | undefined): SortKey {
  return raw === "name" ? "name" : "recent";
}

/** Names compared the way a person reads them: case folded, accents
 *  ignored, and digits as numbers so `chapter-3` sits before `chapter-10`.
 *  One collator, made once; building it per comparison is the slow way
 *  to sort a list. */
const byName = new Intl.Collator(undefined, { sensitivity: "base", numeric: true });

/** The list in the chosen order.
 *
 *  `recent` returns the very array it was given: the server sorts by when
 *  each project was last opened, and handing React the same array keeps
 *  every row's identity quiet.  `name` is a sorted copy, path as the tie
 *  break so two projects called the same thing keep a stable order.  A
 *  missing folder's row sorts like any other; the list does not hide it
 *  at the bottom, since the row is how it is found again. */
export function sortProjects<T extends { name: string; path: string }>(
  projects: T[],
  key: SortKey,
): T[] {
  if (key !== "name") return projects;
  return [...projects].sort(
    (a, b) => byName.compare(a.name, b.name) || byName.compare(a.path, b.path),
  );
}

/** Filter, then sort: the one list the screen draws and the arrow keys
 *  walk, so a key pressed on a row lands where the eye expects. */
export function visibleProjects<T extends { name: string; path: string }>(
  projects: T[],
  query: string,
  key: SortKey,
): T[] {
  const kept = query.trim() ? projects.filter((project) => matches(project, query)) : projects;
  return sortProjects(kept, key);
}
