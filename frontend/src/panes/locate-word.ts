/** Finding, in the source, the word somebody double-clicked on the page.
 *
 *  SyncTeX answers an inverse search with a file and a line and nothing
 *  else: it writes `Column:-1` for every query, on every engine. A writer's
 *  paragraph is one line, so the line alone is the whole paragraph, and
 *  the rest is up to us.
 *
 *  The first version looked for the clicked word on that line and took the
 *  first match. A census of every word on a stress document, double-clicked
 *  in Chromium (bench/inverse-search), found what that gets wrong: a word
 *  used twice in a paragraph always landed on its first use; a single
 *  letter, a number or anything in maths, `$S_0$` set as "S0", was never
 *  found, so the caret went to the start of the paragraph; "red" landed in
 *  `\textcolor{red}`, "section" in `\section`; an accent set as its own
 *  glyph, "Schr¨odinger", and a word hyphenated across lines were never
 *  found either.
 *
 *  So this does not search for the word. It lines up the text around the
 *  click with the source, the way a reader would: both sides are reduced to
 *  their letters and digits, the source with its commands, keys, comments
 *  and maths markup taken out and a map back to its columns kept, and the
 *  place where the page's text and the source's agree for longest on both
 *  sides of the click is where the click was. The word's own letters are
 *  then the range to select. A word TeX made up, a section number, a
 *  footnote mark, "Figure", has no letters in the source, and the command
 *  between its aligned neighbours is selected instead.
 */

import { commentStart } from "./latex-families";

/** What a double-click can say about where it landed.
 *
 *  `word` is the word under the pointer, `before` and `after` the text on
 *  either side of it as it reads on the page, a line or two each way. */
export type WordHint = {
  word: string;
  before?: string;
  after?: string;
  /** The source is prose and not LaTeX, so nothing in it is a command, a
   *  key or a comment: a Markdown line saying "50% of users" keeps its
   *  "users", where the LaTeX reading would drop everything after `%`. */
  plain?: boolean;
};

/** Where the word is: a 1-based line and 0-based columns on it. */
export type Landing = { line: number; from: number; to: number };

/** Letters a font sets without a dot, which NFKD leaves alone. */
const DOTLESS: Record<string, string> = { "ı": "i", "ȷ": "j" };

/** One character of text as the comparison sees it: lower case, no
 *  accents, a ligature as its letters. Empty for anything that is not a
 *  letter or a digit. */
function foldChar(char: string): string {
  // Most of any file is ASCII, and this is called for every character of
  // it when a whole file is searched.
  if (char.length === 1) {
    const code = char.charCodeAt(0);
    if (code < 128) {
      if (code >= 97 && code <= 122) return char;
      if (code >= 65 && code <= 90) return String.fromCharCode(code + 32);
      if (code >= 48 && code <= 57) return char;
      return "";
    }
  }
  let out = "";
  for (const piece of char.normalize("NFKD")) {
    const plain = DOTLESS[piece] ?? piece;
    if (/[\p{L}\p{N}]/u.test(plain) && !/\p{M}/u.test(plain)) out += plain.toLowerCase();
  }
  return out;
}

/** Text from the page reduced to what is compared. */
export function foldText(text: string): string {
  let out = "";
  for (const char of text) out += foldChar(char);
  return out;
}

/** A word from the page, cleaned for a search: kept for the Markdown
 *  pane's own line lookup. Empty when there is nothing to search for. */
export function normaliseWord(raw: string): string {
  let word = (raw ?? "").normalize("NFKD").replace(/\p{M}/gu, "");
  word = word.replace(/[‐-―]/g, "-").replace(/[‘’]/g, "'").replace(/[“”]/g, '"').trim()
    .replace(/^[^\p{L}\p{N}]+/u, "").replace(/[^\p{L}\p{N}]+$/u, "");
  if (word.length < 2 || !/\p{L}/u.test(word)) return "";
  return word;
}

/** Commands whose arguments are not typeset: keys, paths, names, colours.
 *  The number is how many braced arguments to drop. */
const SKIPPED: Record<string, number> = {
  label: 1, ref: 1, eqref: 1, cref: 1, Cref: 1, vref: 1, autoref: 1, pageref: 1,
  nameref: 1, url: 1, href: 1, hyperref: 0, includegraphics: 1, input: 1,
  include: 1, subfile: 1, includeonly: 1, bibliography: 1, bibliographystyle: 1,
  addbibresource: 1, usepackage: 1, RequirePackage: 1, documentclass: 1,
  end: 1, textcolor: 1, color: 1, colorbox: 1, fcolorbox: 2,
  pagecolor: 1, definecolor: 3, rowcolor: 1, cellcolor: 1, hspace: 1,
  vspace: 1, setlength: 2, addtolength: 2, setcounter: 2, addtocounter: 2,
  newcommand: 2, renewcommand: 2, providecommand: 2, newenvironment: 3,
  renewenvironment: 3, pagestyle: 1, thispagestyle: 1, graphicspath: 1,
  bibitem: 1, nocite: 1, rule: 2, multicolumn: 2, multirow: 2,
  resizebox: 2, scalebox: 1, raisebox: 1, makebox: 0, framebox: 0,
  hypersetup: 1, geometry: 1, captionsetup: 1, linespread: 1,
  numberwithin: 2, newtheorem: 2, DeclareMathOperator: 1,
};

/** Every `\cite` variant, which have too many names to list. */
const CITE = /^(?:cite|Cite|parencite|textcite|autocite|footcite|supercite|smartcite)[a-zA-Z]*$/;

/** Environments whose next braced argument is a column specification or
 *  a width rather than text. */
const SPEC_ENVS = new Set(["tabular", "tabular*", "tabularx", "array", "longtable", "tabu", "minipage", "wrapfigure", "multicols"]);

/** Accents written as a symbol after the backslash, `\"o`. */
const SYMBOL_ACCENTS = new Set(['"', "'", "`", "^", "~", "=", "."]);
/** Accents written as a letter after the backslash, `\v{c}`. */
const LETTER_ACCENTS = new Set(["u", "v", "H", "c", "d", "b", "r", "t", "k"]);
/** Commands that set a letter of their own. */
const LETTERS: Record<string, string> = {
  i: "i", j: "j", ss: "ss", o: "o", O: "o", ae: "ae", AE: "ae", oe: "oe",
  OE: "oe", aa: "a", AA: "a", l: "l", L: "l",
};
const GREEK: Record<string, string> = {
  alpha: "α", beta: "β", gamma: "γ", delta: "δ", epsilon: "ε", varepsilon: "ε",
  zeta: "ζ", eta: "η", theta: "θ", vartheta: "θ", iota: "ι", kappa: "κ",
  lambda: "λ", mu: "μ", nu: "ν", xi: "ξ", omicron: "ο", pi: "π", varpi: "π",
  rho: "ρ", varrho: "ρ", sigma: "σ", varsigma: "σ", tau: "τ", upsilon: "υ",
  phi: "φ", varphi: "φ", chi: "χ", psi: "ψ", omega: "ω",
  Gamma: "γ", Delta: "δ", Theta: "θ", Lambda: "λ", Xi: "ξ", Pi: "π",
  Sigma: "σ", Upsilon: "υ", Phi: "φ", Psi: "ψ", Omega: "ω",
};

/** A source line reduced to what TeX would set, as letters and digits.
 *
 *  `from[i]` and `to[i]` are the columns of the source that set the i-th
 *  character, so a match maps back to a range of the line. An accent
 *  macro or a Greek letter covers its whole command. `commands` lists
 *  every command on the line with the index in `text` where it stands,
 *  for a word on the page that has no letters in the source.
 */
export type Projection = {
  text: string;
  from: number[];
  to: number[];
  commands: { at: number; from: number; to: number }[];
};

export function project(line: string, plain = false): Projection {
  const out: Projection = { text: "", from: [], to: [], commands: [] };
  const emit = (letters: string, from: number, to: number) => {
    for (const letter of letters) {
      out.text += letter;
      out.from.push(from);
      out.to.push(to);
    }
  };
  if (plain) {
    // Markdown's own markup is punctuation and drops out by itself; a
    // link's address and an HTML tag are letters the reader never sees.
    const hidden = new Set<number>();
    for (const match of line.matchAll(/\]\([^)]*\)|<[^>]*>/g)) {
      for (let k = match.index!; k < match.index! + match[0].length; k += 1) hidden.add(k);
    }
    let i = 0;
    for (const char of line) {
      if (!hidden.has(i)) emit(foldChar(char), i, i + char.length);
      i += char.length;
    }
    return out;
  }
  const end = (() => {
    const comment = commentStart(line);
    return comment >= 0 ? comment : line.length;
  })();
  // The index after a balanced group opening at `at`, or `at` when there
  // is none there. A group the line does not close runs to its end.
  const group = (at: number, open: string, close: string): number => {
    let i = at;
    while (i < end && line[i] === " ") i += 1;
    if (line[i] !== open) return at;
    let depth = 0;
    for (; i < end; i += 1) {
      if (line[i] === "\\") { i += 1; continue; }
      if (line[i] === open) depth += 1;
      else if (line[i] === close && (depth -= 1) === 0) return i + 1;
    }
    return end;
  };
  // Places to skip ahead from when the walk reaches them.
  const jumps = new Map<number, number>();
  let i = 0;
  while (i < end) {
    const jump = jumps.get(i);
    if (jump !== undefined) {
      i = jump;
      continue;
    }
    const char = line[i];
    if (char !== "\\") {
      const code = line.codePointAt(i)!;
      const width = code > 0xffff ? 2 : 1;
      emit(foldChar(line.slice(i, i + width)), i, i + width);
      i += width;
      continue;
    }
    const next = line[i + 1] ?? "";
    // `\"o`, `\'{e}`, `\^\i`: the letter the accent sits on.
    if (SYMBOL_ACCENTS.has(next)) {
      const accent = /^\\.\s*(?:\{\s*(\\[ij]|[A-Za-z])\s*\}|(\\[ij](?![A-Za-z])|[A-Za-z]))/.exec(line.slice(i, end));
      if (accent) {
        const letter = (accent[1] ?? accent[2]).replace("\\", "");
        emit(foldChar(letter), i, i + accent[0].length);
        i += accent[0].length;
        continue;
      }
      i += 2;
      continue;
    }
    if (!/[A-Za-z@]/.test(next)) {
      // `\\`, `\%`, `\,` and the rest: nothing a reader would double-click.
      i += 2;
      continue;
    }
    const name = /^[A-Za-z@]+\*?/.exec(line.slice(i + 1, end))![0];
    const bare = name.replace(/\*$/, "");
    const start = i;
    i += 1 + name.length;
    out.commands.push({ at: out.text.length, from: start, to: i });
    if (LETTER_ACCENTS.has(bare)) {
      const accent = /^\s*(?:\{\s*(\\[ij]|[A-Za-z])\s*\}|\s(\\[ij]|[A-Za-z]))/.exec(line.slice(i, end));
      if (accent) {
        emit(foldChar((accent[1] ?? accent[2]).replace("\\", "")), start, i + accent[0].length);
        i += accent[0].length;
        continue;
      }
    }
    if (bare in LETTERS) { emit(LETTERS[bare], start, i); continue; }
    if (bare in GREEK) { emit(GREEK[bare], start, i); continue; }
    // A citation's notes are typeset, "[2, p. 4]", and its key is not: the
    // notes are read on as text and the key is jumped when it is reached.
    if (CITE.test(bare)) {
      let at = i;
      for (let after = group(at, "[", "]"); after !== at; after = group(at, "[", "]")) at = after;
      let key = at;
      while (key < end && line[key] === " ") key += 1;
      const close = group(key, "{", "}");
      if (close !== key) jumps.set(key, close);
      continue;
    }
    if (bare === "begin") {
      let at = group(i, "{", "}");
      const env = line.slice(i, at).replace(/[\s{}]/g, "");
      // A float's placement, `[h!]`, is not text; a theorem's title,
      // `[Main result]`, is.
      const option = group(at, "[", "]");
      if (option !== at && /^[htbpH!\s[\]]*$/.test(line.slice(at, option))) at = option;
      // `\begin{tabular}{lcc}`: the column specification is not text.
      if (SPEC_ENVS.has(env)) at = group(at, "{", "}");
      if (env === "tabular*" || env === "tabularx") at = group(at, "{", "}");
      i = at;
      continue;
    }
    const skip = SKIPPED[bare] ?? 0;
    if (skip) {
      let at = group(i, "[", "]");
      for (let n = 0; n < skip; n += 1) {
        at = group(at, "{", "}");
        at = group(at, "[", "]");
      }
      i = at;
    }
  }
  return out;
}

/** How far two texts agree, walking from their starts.
 *
 *  Not a strict prefix: TeX puts things on the page the source does not
 *  have, a section number, a footnote mark, a list label, and the source
 *  has things the page does not, a reference's key. So when the two
 *  disagree the walk tries skipping a few characters on either side to
 *  find agreement again, and stops when it cannot. The score is the number
 *  of characters that agreed, less the number skipped. */
export function agreement(page: string, source: string, limit: number): number {
  let i = 0;
  let j = 0;
  let score = 0;
  // Up to eight characters either side, "Table 1" in a caption; a long
  // skip has to be confirmed by more agreement after it than a short one,
  // or chance would carry the walk through text that does not match.
  const SKIP = 8;
  const resync = (total: number) => (total <= 4 ? 3 : 5);
  while (i < page.length && j < source.length && i < limit) {
    if (page[i] === source[j]) {
      score += 1;
      i += 1;
      j += 1;
      continue;
    }
    let moved = false;
    search: for (let total = 1; total <= SKIP * 2; total += 1) {
      for (let a = 0; a <= Math.min(total, SKIP); a += 1) {
        const b = total - a;
        if (b > SKIP) continue;
        const need = resync(total);
        if (i + a + need <= page.length
            && page.slice(i + a, i + a + need) === source.slice(j + b, j + b + need)) {
          i += a;
          j += b;
          // A skip is a disagreement, and costs what it skipped: otherwise
          // a "2" found inside "2020" agreed as well on both sides as the
          // bibliography label it was not.
          score -= total;
          moved = true;
          break search;
        }
      }
    }
    if (!moved) break;
  }
  return score;
}

const reverse = (text: string) => [...text].reverse().join("");

/** How many characters of context on each side are compared. */
const REACH = 60;
/** How much agreement beside a word makes it the word without asking
 *  where its neighbours meet. */
const CLEAR = 8;

/** The source lines around the one synctex named, as one text.
 *
 *  Joined, so a paragraph wrapped by hand over several source lines is
 *  compared as the one paragraph it is on the page. `line[i]` is the
 *  source line the i-th character came from. */
type Window = {
  text: string;
  from: Int32Array;
  to: Int32Array;
  line: Int32Array;
  commands: { at: number; from: number; to: number; line: number }[];
};

function windowOf(readLine: (line: number) => string, first: number, last: number, plain: boolean): Window {
  // Projected first and copied once into arrays of the right size: a
  // whole thesis is a million characters, and growing ordinary arrays a
  // character at a time cost most of a search through one.
  const parts: Projection[] = [];
  let size = 0;
  for (let number = first; number <= last; number += 1) {
    const part = project(readLine(number), plain);
    parts.push(part);
    size += part.text.length;
  }
  const all: Window = {
    text: parts.map((part) => part.text).join(""),
    from: new Int32Array(size),
    to: new Int32Array(size),
    line: new Int32Array(size),
    commands: [],
  };
  let at = 0;
  parts.forEach((part, index) => {
    const number = first + index;
    for (const command of part.commands) all.commands.push({ ...command, at: at + command.at, line: number });
    all.from.set(part.from, at);
    all.to.set(part.to, at);
    all.line.fill(number, at, at + part.text.length);
    at += part.text.length;
  });
  return all;
}

type Scored = { start: number; end: number; score: number };

/** The best place in the window for the word, judged by its context. */
function bestPlace(
  window: Window,
  word: string,
  before: string,
  after: string,
  near: number,
  wide = false,
): Scored | null {
  const left = reverse(before.slice(-REACH));
  const right = after.slice(0, REACH);
  const distance = (index: number) => Math.min(Math.abs(window.line[index] - near), 400);
  let best: Scored | null = null;
  const consider = (start: number, end: number, own: number) => {
    const score = own
      + agreement(left, reverse(window.text.slice(Math.max(0, start - REACH * 2), start)), REACH)
      + agreement(right, window.text.slice(end, end + REACH * 2), REACH)
      // Ties go to the line synctex named, then the nearest; never enough
      // to outweigh a single character of agreement.
      - distance(Math.min(start, window.text.length - 1)) / 1000;
    if (!best || score > best.score) best = { start, end, score };
  };
  if (word) {
    // Across a whole file a short word is everywhere, so the search there
    // starts from the word with a little of its context on one side or
    // the other, which is rare. One side, since either may hold something
    // TeX made: a section number before a heading's word, a footnote mark
    // after a word.
    const needles: { lead: string; text: string }[] = [];
    if (!wide) needles.push({ lead: "", text: word });
    else {
      const lead = reverse(left.slice(0, 8));
      const trail = right.slice(0, 8);
      if (lead.length >= 4) needles.push({ lead, text: lead + word });
      if (trail.length >= 4) needles.push({ lead: "", text: word + trail });
      if (!needles.length && word.length >= 4) needles.push({ lead: "", text: word });
    }
    for (const needle of needles) {
      for (let at = window.text.indexOf(needle.text); at >= 0; at = window.text.indexOf(needle.text, at + 1)) {
        consider(at + needle.lead.length, at + needle.lead.length + word.length, word.length);
      }
    }
    if (wide) return best;
    // Found with real agreement beside it: that is the word, and the
    // neighbours' meeting place below is not asked. Otherwise a footnote's
    // word, whose page context runs on from the body text above it, lost
    // to the end of that body text.
    const found = best as Scored | null;
    if (found && found.score - word.length >= CLEAR) return found;
  }
  // And where the neighbours meet, whether or not the word was found. A
  // word TeX made up, a section number, "Figure", a footnote mark, has no
  // letters in the source; when the same letters happen to be somewhere
  // else, "Table" in a heading "Tables and figures", the neighbours agree
  // far better here than there. It costs a little, so that a word found
  // with its neighbours always wins.
  // Six letters, or what there is down to three, and tried a character
  // or two in, past a number TeX set beside the word, "Figure 1:".
  const ANCHOR = 6;
  const LEAST = 3;
  const COST = 2;
  for (let skip = 0; skip <= 2; skip += 1) {
    const anchor = reverse(left.slice(skip, skip + ANCHOR));
    if (anchor.length >= LEAST) {
      for (let at = window.text.indexOf(anchor); at >= 0; at = window.text.indexOf(anchor, at + 1)) {
        consider(at + anchor.length, at + anchor.length, -COST - skip);
      }
    }
    const tail = right.slice(skip, skip + ANCHOR);
    if (tail.length >= LEAST) {
      for (let at = window.text.indexOf(tail); at >= 0; at = window.text.indexOf(tail, at + 1)) {
        consider(at, at, -COST - skip);
      }
    }
  }
  return best;
}

/** How much of the context that was there to agree with did agree.
 *
 *  A match near the line synctex named that agrees on most of it is
 *  taken as it is; one that does not sends the search through the whole
 *  file, in case the source moved since the build. A match found there
 *  is believed on less, since a float or a footnote can take the page's
 *  context away on one side, but never on a few letters. */
function agreed(place: Scored, word: string, before: string, after: string): number {
  const available = word.length + Math.min(before.length, REACH) + Math.min(after.length, REACH);
  return available ? place.score / available : 0;
}
const SURE = 0.6;
const FAR = 0.3;
const FAR_LEAST = 16;

/** Where the word is, searching from the line synctex named.
 *
 *  `readLine` is 1-based, matching both CodeMirror and synctex. Null
 *  means nothing near agreed, and the caller goes to the start of the
 *  line as it did before any of this.
 */
export function locateWord(
  readLine: (line: number) => string,
  totalLines: number,
  near: number,
  raw: string | WordHint,
  radius = 40,
): Landing | null {
  const hint: WordHint = typeof raw === "string" ? { word: raw } : raw;
  if (totalLines < 1) return null;
  const plain = hint.plain ?? false;
  const word = foldText(hint.word ?? "");
  const before = foldText(hint.before ?? "");
  const after = foldText(hint.after ?? "");
  if (!word && !before && !after) return null;
  // A number with nothing after it on the page is the page's number, which
  // no line of the source set.
  if (/^\d+$/.test(word) && !after) return null;
  // A stale PDF can name a line the file no longer has.
  const start = Math.min(Math.max(near, 1), totalLines);

  // The word as the page has it, then without a number stuck to either
  // end: a footnote mark set against its word, "method1", or a list's
  // label against the item, "1See". The digits go back to the context.
  const variants: { word: string; before: string; after: string }[] = [{ word, before, after }];
  const trailing = /\d+$/.exec(word)?.[0] ?? "";
  if (trailing && trailing.length < word.length) {
    variants.push({ word: word.slice(0, -trailing.length), before, after: trailing + after });
  }
  const leading = /^\d+/.exec(word)?.[0] ?? "";
  if (leading && leading.length < word.length) {
    variants.push({ word: word.slice(leading.length), before: before + leading, after });
  }

  const local = windowOf(readLine, Math.max(1, start - radius), Math.min(totalLines, start + radius), plain);
  let window = local;
  // The first variant whose letters are found; failing that, where the
  // page's own word would sit between its neighbours.
  let place: Scored | null = null;
  let used = variants[0];
  for (const variant of variants) {
    const found = bestPlace(local, variant.word, variant.before, variant.after, start);
    if (found && found.end > found.start) {
      place = found;
      used = variant;
      break;
    }
    if (variant === variants[0]) place = found;
  }
  // Nothing near agrees: the source moved since the build, further than
  // the window. The whole file is searched, and believed only when the
  // context agrees well.
  const whole = start - radius > 1 || start + radius < totalLines;
  if (whole && (!place || agreed(place, used.word, used.before, used.after) < SURE)) {
    const all = windowOf(readLine, 1, totalLines, plain);
    for (const variant of variants) {
      const far = bestPlace(all, variant.word, variant.before, variant.after, start, true);
      if (far && far.score >= FAR_LEAST && agreed(far, variant.word, variant.before, variant.after) >= FAR
          && (!place || far.score > place.score)) {
        window = all;
        place = far;
        break;
      }
    }
  }
  if (!place) return null;
  // One character of agreement is chance, not a match.
  if (place.score < 2) return null;
  return rangeOf(window, place, readLine);
}

/** The source range the place in the window stands for. */
function rangeOf(window: Window, place: Scored, readLine: (line: number) => string): Landing | null {
  if (place.end > place.start) {
    const line = window.line[place.start];
    let last = place.end - 1;
    while (last > place.start && window.line[last] !== line) last -= 1;
    return { line, from: window.from[place.start], to: window.to[last] };
  }
  // No letters to select: the command standing between the neighbours,
  // `\subsection` for its number, `\footnote` for its mark, `\caption`
  // for "Figure".
  // The last command standing there that makes text: `\caption` after a
  // figure's `\begin` and `\centering`, `\item` after a list's `\begin`.
  const here = window.commands.filter((command) => command.at === place.start);
  const quiet = /^\\(?:begin|end|label|centering|raggedright|raggedleft|par|noindent|rule|hline|toprule|midrule|bottomrule|newline|linebreak|small|footnotesize|large|Large|bfseries|itshape|vspace|hspace|medskip|bigskip|smallskip)\b/;
  const pick = [...here].reverse().find((command) => !quiet.test(readLine(command.line).slice(command.from, command.to)))
    ?? here[here.length - 1];
  if (pick) {
    // `\begin{theorem}` for "Theorem 1", whole, since the name is what
    // made the word.
    const text = readLine(pick.line);
    const name = /^\\(?:begin|end)\b/.test(text.slice(pick.from, pick.to))
      ? /^\s*\{[^}]*\}/.exec(text.slice(pick.to))?.[0] ?? "" : "";
    return { line: pick.line, from: pick.from, to: pick.to + name.length };
  }
  // Between two letters of prose: the caret goes after the one before,
  // which is on the line the neighbours agreed on, where the one after
  // can be the first letter of the next paragraph.
  if (!window.text.length) return null;
  const index = place.start > 0 ? place.start - 1 : 0;
  const line = window.line[index];
  const at = place.start > 0 ? window.to[index] : window.from[index];
  return { line, from: at, to: at };
}
