/** How the command palette orders what it finds.
 *
 *  Typing is matched as a subsequence of the label, case-folded, so
 *  `fld` finds "Fold the section" and `dl pdf` finds "Download the PDF";
 *  a letter that starts a word counts for more than one inside, and a
 *  run of letters matched in a row counts for more than letters spread
 *  out, so "Save now" beats "Show or hide the agent" for `sa`.  Pure, so
 *  the cases are a vitest.
 */

export type Ranked<T> = { item: T; score: number };

/** The score of `query` against `text`, or null when it is not a
 *  subsequence.  Higher is better. */
export function score(query: string, text: string): number | null {
  const wanted = query.toLowerCase().replace(/\s+/g, "");
  if (!wanted) return 0;
  const haystack = text.toLowerCase();
  let total = 0;
  let at = 0;
  let previous = -2;
  for (const letter of wanted) {
    const found = haystack.indexOf(letter, at);
    if (found === -1) return null;
    const starts = found === 0 || /[\s/.\-_]/.test(haystack[found - 1]);
    total += starts ? 3 : 1;
    if (found === previous + 1) total += 2;
    previous = found;
    at = found + 1;
  }
  // A shorter label that matches is the more exact answer.
  return total - haystack.length / 100;
}

/** The items that match, best first; with no query, all of them in the
 *  order given. */
export function rank<T>(query: string, items: T[], text: (item: T) => string): T[] {
  if (!query.trim()) return items;
  const kept: Ranked<T>[] = [];
  for (const item of items) {
    const found = score(query, text(item));
    if (found !== null) kept.push({ item, score: found });
  }
  kept.sort((a, b) => b.score - a.score);
  return kept.map((entry) => entry.item);
}
