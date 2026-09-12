/** What the writer probably meant.
 *
 *  The menu on a misspelled word offered one thing, "Add to the
 *  dictionary", which is the right answer for a surname and the wrong one
 *  for a typo, and a typo is the common case. There is a ninety-eight
 *  kilobyte word list already loaded by the time a word is underlined at
 *  all, so the suggestions cost a lookup rather than a download.
 *
 *  Edit distance rather than phonetics. A soundalike index would catch
 *  "fizix" and this will not, but it would also need its own table and its
 *  own chunk, and the mistakes people actually make while typing are
 *  transpositions, doubled letters and dropped letters, which are all one
 *  edit away.
 */

const LETTERS = "abcdefghijklmnopqrstuvwxyz";

/** Every word one edit from this one: a deletion, a transposition, a
 *  replacement or an insertion. About fifty-four per character. */
function neighbours(word: string): string[] {
  const out: string[] = [];
  for (let i = 0; i < word.length; i += 1) {
    out.push(word.slice(0, i) + word.slice(i + 1));
    if (i + 1 < word.length) {
      out.push(word.slice(0, i) + word[i + 1] + word[i] + word.slice(i + 2));
    }
    for (const letter of LETTERS) {
      if (letter !== word[i]) out.push(word.slice(0, i) + letter + word.slice(i + 1));
    }
  }
  for (let i = 0; i <= word.length; i += 1) {
    for (const letter of LETTERS) out.push(word.slice(0, i) + letter + word.slice(i));
  }
  return out;
}

/** Suggestions for a word the list does not have, nearest first.
 *
 *  `has` is asked rather than a set being passed, so the caller decides
 *  what counts as known: the shipped list and the writer's own additions
 *  are two different collections and both should silence a suggestion.
 *
 *  Distance two is searched only when distance one comes up short, and only
 *  from the first few hundred distance-one candidates, because the work
 *  grows as the square and this runs while a menu is opening.
 */
export function suggest(
  word: string,
  has: (candidate: string) => boolean,
  limit = 4,
): string[] {
  const clean = word.toLowerCase();
  if (clean.length < 2 || clean.length > 24) return [];

  const seen = new Set<string>([clean]);
  const found: string[] = [];
  const near = neighbours(clean);

  for (const candidate of near) {
    if (seen.has(candidate)) continue;
    seen.add(candidate);
    if (has(candidate)) found.push(candidate);
    if (found.length >= limit) return cased(word, found);
  }

  // Two edits, from the nearest candidates only. A word that is two edits
  // from everything is usually a name rather than a typo, and the honest
  // answer there is the one the menu already had.
  for (const first of near.slice(0, 400)) {
    for (const candidate of neighbours(first)) {
      if (seen.has(candidate)) continue;
      seen.add(candidate);
      if (has(candidate)) found.push(candidate);
      if (found.length >= limit) return cased(word, found);
    }
  }
  return cased(word, found);
}

/** Give a suggestion the shape of the word it is replacing, so a
 *  sentence-initial `Recieve` is offered as `Receive` rather than as
 *  something the writer would then have to fix by hand. */
function cased(original: string, words: string[]): string[] {
  if (original === original.toUpperCase() && original.length > 1) {
    return words.map((w) => w.toUpperCase());
  }
  if (original[0] === original[0]?.toUpperCase()) {
    return words.map((w) => w[0].toUpperCase() + w.slice(1));
  }
  return words;
}
