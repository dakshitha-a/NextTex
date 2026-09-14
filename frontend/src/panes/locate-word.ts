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

import { TITLED, commentStart } from "./latex-families";

/** What a double-click on the page can say about where it landed.
 *
 *  The word is what the browser selected on the second click.  The context
 *  is the whole text-layer span the word sits in, which is the typeset
 *  line, and it is what tells a `\section{Results}` from a paragraph that
 *  happens to start with "Results".  The heading flag is the preview's
 *  reading of the span's size and its leading number: a heading's synctex
 *  box ends at its baseline, so the line synctex names for a click in the
 *  lower part of a heading is the paragraph beneath it, and the search has
 *  to know to look for a `\section` line rather than take the paragraph's
 *  word for it.
 */
export type WordHint = {
  word: string;
  context?: string;
  heading?: boolean;
};

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

/** Commands whose braced argument is a key, a path or a name, never the
 *  prose that was typeset.  A heading's word inside `\label{sec:results}`
 *  is not the heading, and a search that matched it there landed the
 *  cursor one line under the heading on every click. */
const KEYED = /\\(?:label|ref|cref|Cref|eqref|autoref|pageref|nameref|hyperref|cite[a-zA-Z*]*|url|href|includegraphics|input|include|subfile|bibliography|bibliographystyle|usepackage|documentclass|begin|end)\*?\s*(?:\[[^\]]*\])?\s*\{([^}]*)\}/g;

/** The line with everything that is not prose blanked out, at the same
 *  length, so a column found in it is a column in the original.  Keys are
 *  blanked; a comment is blanked from its `%` to the end. */
export function stripKeys(text: string): string {
  let out = text.replace(KEYED, (whole, inner: string) => {
    const start = whole.length - inner.length - 1;
    return whole.slice(0, start) + " ".repeat(inner.length) + "}";
  });
  const comment = commentStart(out);
  if (comment >= 0) out = out.slice(0, comment) + " ".repeat(out.length - comment);
  return out;
}

const HEADING = new RegExp(
  `^\\s*\\\\(?:${[...TITLED].join("|")})\\*?\\s*[\\[{]`,
);

/** Whether the line is a `\section{...}` or one of its relatives. */
export function isHeadingLine(text: string): boolean {
  return HEADING.test(text);
}

/** The words of a typeset line that are worth scoring a source line by:
 *  three letters or more, so "of" and "a" do not vote, and each once. */
function contextWords(context: string | undefined, except: string): string[] {
  if (!context) return [];
  const seen = new Set<string>();
  for (const piece of context.split(/\s+/)) {
    const word = normaliseWord(piece).toLowerCase();
    if (word.length >= 3 && word !== except.toLowerCase()) seen.add(word);
  }
  return [...seen];
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
  raw: string | WordHint,
  radius = 40,
): { line: number; column: number } | null {
  const hint: WordHint = typeof raw === "string" ? { word: raw } : raw;
  const word = normaliseWord(hint.word);
  if (totalLines < 1) return null;
  // A stale PDF can name a line the file no longer has -- the source was
  // shortened and not yet rebuilt. Start from the nearest line that exists
  // rather than searching a range entirely outside the document.
  const start = Math.min(Math.max(near, 1), totalLines);

  // The named line first, then alternating outwards: below before above,
  // because a line that moved usually moved down, past whatever was
  // inserted before it.
  // A heading is looked for above before below, the other way round: the
  // line synctex names for a click in the lower part of a heading is the
  // paragraph *under* it, so the heading is behind us, and the next
  // heading down is the wrong one.
  const order = (limit: number, aboveFirst = false): number[] => {
    const lines: number[] = [];
    for (let offset = 0; offset <= limit; offset += 1) {
      const pair = aboveFirst
        ? [start - offset, start + offset]
        : [start + offset, start - offset];
      for (const line of offset === 0 ? [start] : pair) {
        if (line >= 1 && line <= totalLines) lines.push(line);
      }
    }
    return lines;
  };

  if (!word) {
    // Nothing to search for: a number, a symbol.  A heading's number is
    // the common case, and the heading is still what was clicked, so the
    // nearest heading line stands in for the word.
    if (hint.heading) {
      for (const line of order(8, true)) {
        if (isHeadingLine(readLine(line))) return { line, column: 1 };
      }
    }
    return null;
  }

  // Not \b at both ends: a word may sit against a macro brace or a tilde,
  // both of which are non-word characters, but it must not match inside a
  // longer word -- "the" should not land in "theory".
  const pattern = new RegExp(`(?<![\\p{L}\\p{N}])${escape(word)}(?![\\p{L}\\p{N}])`, "iu");
  const lines = order(radius);

  // A heading first, when the click said it was one.  The line synctex
  // named is the paragraph under the heading as often as the heading, and
  // the paragraph frequently opens with the heading's own word.
  if (hint.heading) {
    for (const line of order(radius, true)) {
      const text = readLine(line);
      if (!isHeadingLine(text)) continue;
      const found = stripKeys(text).search(pattern);
      if (found >= 0) return { line, column: found + 1 };
    }
  }

  // Every line near here that has the word as prose, then the one that
  // shares the most of the typeset line around it.  Ties keep the search
  // order, which is the old answer: the nearest, below before above.
  const votes = contextWords(hint.context, word);
  let best: { line: number; column: number; score: number } | null = null;
  for (const line of lines) {
    const text = stripKeys(readLine(line));
    const found = text.search(pattern);
    if (found < 0) continue;
    if (!votes.length) return { line, column: found + 1 };
    const lower = text.toLowerCase();
    let score = 0;
    for (const vote of votes) {
      if (new RegExp(`(?<![\\p{L}\\p{N}])${escape(vote)}(?![\\p{L}\\p{N}])`, "iu").test(lower)) {
        score += 1;
      }
    }
    if (!best || score > best.score) best = { line, column: found + 1, score };
  }
  return best ? { line: best.line, column: best.column } : null;
}
