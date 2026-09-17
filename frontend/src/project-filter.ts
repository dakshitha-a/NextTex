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
