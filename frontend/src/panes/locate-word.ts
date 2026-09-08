/** Finding, in the source, the word somebody double-clicked on the page.
 *
 *  SyncTeX answers an inverse search with a file and a line and nothing
 *  else: it writes `Column:-1` for every query, on every engine, so the
 *  cursor can only ever land at the start of the line the click came from.
 *  For a paragraph of prose wrapped at eighty columns that is close to the
 *  word and not on it, which is exactly what it feels like -- the jump
 *  works, and then you still have to find the sentence with your eyes.
 *
 *  The double-click has already told us more than synctex will. The browser
 *  selects a word on the second click, and that word is in the document the
 *  reader is looking at. So: take the line synctex gives, look for the word
 *  on it, and widen the search a little if it is not there.
 *
 *  Widening also repairs the other half of the complaint. SyncTeX's line is
 *  itself approximate around display maths, floats and macros that move
 *  text about, and a search that starts at its answer and walks outwards
 *  lands on the right words even when the line is a few out.
 */

/** Ligatures a PDF renders as one glyph and a `.tex` file spells as two.
 *  Without this, double-clicking "efficient" hands back "eﬃcient", which
 *  matches nothing in the source. */
const LIGATURES: Record<string, string> = {
  "ﬀ": "ff",
  "ﬁ": "fi",
  "ﬂ": "fl",
  "ﬃ": "ffi",
  "ﬄ": "ffl",
  "ﬅ": "st",
  "ﬆ": "st",
};

/** What a word from the page looks like once it could be in a source file.
 *
 *  Returns "" for anything not worth searching for -- punctuation, a single
 *  character, a number -- because a one-letter match anywhere on the line
 *  is worse than no match at all: it would move the cursor confidently to
 *  the wrong place, which is harder to recover from than leaving it where
 *  synctex put it.
 */
export function normaliseWord(raw: string): string {
  let word = (raw ?? "").normalize("NFKD");
  for (const [glyph, letters] of Object.entries(LIGATURES)) {
    word = word.split(glyph).join(letters);
  }
  word = word
    // Combining marks left by NFKD: the source may spell an accent as a
    // macro, so matching the bare letters is more likely to succeed.
    .replace(/[̀-ͯ]/g, "")
    // The dashes TeX sets from -- and ---, and the quotes it sets from ``.
    .replace(/[‐-―]/g, "-")
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .trim()
    // Punctuation the typesetter attached but the source may not have.
    .replace(/^[^\p{L}\p{N}]+/u, "")
    .replace(/[^\p{L}\p{N}]+$/u, "");

  if (word.length < 2) return "";
  if (!/\p{L}/u.test(word)) return "";
  return word;
}

function escape(word: string): string {
  // Not the hyphen. `\-` is a valid escape in an ordinary regular
  // expression and an *invalid* one under the `u` flag, so escaping it here
  // threw on every hyphenated word -- "cross-reference", "Franck-Condon" --
  // which is to say on exactly the words worth double-clicking. Outside a
  // character class it has no special meaning and needs no escape.
  return word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Where the word is, searching outwards from the line synctex named.
 *
 *  `readLine` is 1-based, matching both CodeMirror and synctex. The result
 *  is 1-based too. Null means "not found near here", and the caller should
 *  do exactly what it did before: go to the start of the line.
 */
export function locateWord(
  readLine: (line: number) => string,
  totalLines: number,
  near: number,
  raw: string,
  radius = 40,
): { line: number; column: number } | null {
  const word = normaliseWord(raw);
  if (!word) return null;
  if (totalLines < 1) return null;
  // A stale PDF can name a line the file no longer has -- the source was
  // shortened and not yet rebuilt. Start from the nearest line that exists
  // rather than searching a range entirely outside the document.
  const start = Math.min(Math.max(near, 1), totalLines);

  // Not \b at both ends: a word may sit against a macro brace or a tilde,
  // both of which are non-word characters, but it must not match inside a
  // longer word -- "the" should not land in "theory".
  const pattern = new RegExp(`(?<![\\p{L}\\p{N}])${escape(word)}(?![\\p{L}\\p{N}])`, "iu");

  for (let offset = 0; offset <= radius; offset += 1) {
    // The named line first, then alternating outwards: below before above,
    // because a line that moved usually moved down, past whatever was
    // inserted before it.
    for (const line of offset === 0 ? [start] : [start + offset, start - offset]) {
      if (line < 1 || line > totalLines) continue;
      const text = readLine(line);
      const found = text.search(pattern);
      if (found >= 0) return { line, column: found + 1 };
    }
  }
  return null;
}
