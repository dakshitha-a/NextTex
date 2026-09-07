// Which parts of a line of LaTeX are prose.
//
// This is the whole difficulty of spell checking a LaTeX document, and the
// reason CodeMirror turns the browser's own checker off: a source file is
// mostly not English.  `\usepackage{amsmath}`, `\cite{Matsika2011}`,
// `\label{sec:motivation}` and `\begin{tabular}{lcc}` are all perfectly
// correct and none of them is a word.  Underlining them teaches the writer
// to ignore the underlines, which is worse than not having any.
//
// So the scan subtracts rather than adds: everything that cannot be prose
// is masked off -- comments, control sequences, mathematics, optional
// arguments, and the braced argument of every command whose argument is an
// identifier rather than a sentence -- and what is left is checked.

import { braceAfter, commentStart, inlineMath } from "./latex-families";

export type Word = { from: number; to: number; word: string };

/** Commands whose braced argument is a name, a key or a number.
 *
 *  The distinction that matters is not which family a command belongs to.
 *  `\caption{...}`, `\section{...}` and `\item ...` all take prose and must
 *  be checked -- a typo in a heading is exactly the one a writer most wants
 *  caught -- while `\begin{...}` and `\label{...}` never do. */
const OPAQUE = new Set([
  "begin", "end",
  "cite", "citep", "citet", "citealp", "citealt", "citeauthor", "citeyear",
  "citenum", "textcite", "parencite", "autocite", "footcite", "supercite",
  "ref", "eqref", "autoref", "cref", "Cref", "vref", "pageref", "nameref",
  "label", "bibliography", "bibliographystyle", "printbibliography",
  "addbibresource", "url", "href", "doi", "hypersetup",
  "includegraphics", "input", "include", "includeonly", "graphicspath",
  "usepackage", "RequirePackage", "documentclass", "usetikzlibrary",
  "definecolor", "rowcolor", "cellcolor", "setlength", "addtolength",
  "setcounter", "addtocounter", "numberwithin", "newcolumntype",
  "pagestyle", "thispagestyle", "geometry", "linespread", "pagenumbering",
  "newcommand", "renewcommand", "providecommand", "newenvironment",
  "renewenvironment", "DeclareMathOperator", "newtheorem",
  "resizebox", "multicolumn", "multirow", "texttt", "verb",
]);

/** Environments whose contents are not prose at all, however many lines
 *  they run to.
 *
 *  Masking `$...$` within a line is not enough: a displayed equation is
 *  usually three or four lines between `\begin{align}` and `\end{align}`,
 *  and a listing can be fifty.  Nothing inside either is English, and a
 *  `\text{...}` in the middle of an equation is a label rather than a
 *  sentence. */
export const OPAQUE_ENVIRONMENTS = new Set([
  // mathematics
  "equation", "align", "alignat", "gather", "multline", "split", "cases",
  "eqnarray", "displaymath", "math", "aligned", "gathered", "alignedat",
  "array", "matrix", "pmatrix", "bmatrix", "vmatrix", "Vmatrix", "Bmatrix",
  "smallmatrix", "IEEEeqnarray", "dmath",
  // set literally, on purpose
  "verbatim", "Verbatim", "lstlisting", "minted", "alltt", "filecontents",
  "tikzpicture", "picture", "tabbing",
]);

/** Which lines are inside one of those, 1-based.
 *
 *  Whole lines rather than exact ranges: an equation body is a whole line
 *  of it, and the `\begin{...}` and `\end{...}` lines carry nothing but
 *  the command and its environment name, which the per-line scan already
 *  masks off.
 */
export function skippedLines(lines: readonly string[]): Set<number> {
  const out = new Set<number>();
  // How deep inside an opaque environment we are.  Nesting is counted so
  // that an `array` inside an `equation` does not end the equation.
  let depth = 0;
  let display = false;
  lines.forEach((raw, index) => {
    const cut = commentStart(raw);
    const text = cut < 0 ? raw : raw.slice(0, cut);
    if (depth > 0 || display) out.add(index + 1);

    for (const found of text.matchAll(/\\(begin|end)\s*\{([^}]*)\}|\\(\[|\])/g)) {
      const bracket = found[3];
      if (bracket) {
        display = bracket === "[";
        continue;
      }
      const name = found[2].endsWith("*") ? found[2].slice(0, -1) : found[2];
      if (found[1] === "begin") {
        if (depth > 0) depth += 1;
        else if (OPAQUE_ENVIRONMENTS.has(name)) depth = 1;
      } else if (depth > 0) {
        depth -= 1;
      }
    }
  });
  return out;
}

/** A word worth checking: letters, with internal hyphens and apostrophes.
 *  Anything with a digit in it is a label or a measurement, not a word. */
const WORD = /[A-Za-z][A-Za-z'’-]*/g;

/** Words that are correct by construction rather than by dictionary.
 *
 *  Acronyms are spelled by their initials and no word list holds them, and
 *  a two-letter word is either a real one every list has or a stray
 *  subscript; in both cases underlining it is noise. */
export function worthChecking(word: string): boolean {
  if (word.length < 3) return false;
  if (word === word.toUpperCase()) return false;
  return true;
}

/** A word as it should be looked up: lower case, without the possessive.
 *  The list holds `abbey`, and `Abbey's` at the start of a sentence is the
 *  same word twice over. */
export function normalise(word: string): string {
  return word
    .toLowerCase()
    .replace(/[’']s$/, "")
    .replace(/^[-'’]+|[-'’]+$/g, "");
}

/** The prose in one line, as ranges into it. */
export function proseWords(text: string): Word[] {
  const cut = commentStart(text);
  const line = cut < 0 ? text : text.slice(0, cut);
  // A byte per column: cheaper to write than a sorted range list is to
  // search, and a line of LaTeX is short.
  const masked = new Uint8Array(line.length);
  const mask = (from: number, to: number) => {
    for (let i = Math.max(0, from); i < Math.min(line.length, to); i += 1) {
      masked[i] = 1;
    }
  };

  for (const span of inlineMath(line)) mask(span.from, span.to);

  for (const found of line.matchAll(/\\([a-zA-Z@]+\*?)/g)) {
    const name = found[1];
    const at = found.index ?? 0;
    const after = at + 1 + name.length;
    mask(at, after);
    const bare = name.endsWith("*") ? name.slice(0, -1) : name;

    // `\verb` takes whatever character comes next as its delimiter, so the
    // brace scanner never sees it: `\verb|rm -rf|` and `\verb+x+ ` are both
    // ordinary usage and neither is English.
    if (bare === "verb") {
      const delimiter = line[after];
      if (delimiter && delimiter !== " ") {
        const shut = line.indexOf(delimiter, after + 1);
        mask(after, shut < 0 ? line.length : shut + 1);
      }
      continue;
    }

    // An optional argument is a key, a length or a placement -- `[12pt]`,
    // `[width=0.8\textwidth]`, `[t]`.  Never a sentence.
    let cursor = after;
    while (line[cursor] === " ") cursor += 1;
    if (line[cursor] === "[") {
      const shut = line.indexOf("]", cursor);
      if (shut > 0) {
        mask(cursor, shut + 1);
        cursor = shut + 1;
      }
    }

    if (OPAQUE.has(bare)) {
      const arg = braceAfter(line, after);
      if (arg) mask(arg.open, arg.close + 1);
      // `\begin{tabular}{lcc}` -- the column specification is a second
      // argument and is no more prose than the first.
      if (arg && (bare === "begin" || bare === "end" || bare === "multicolumn")) {
        const second = braceAfter(line, arg.close + 1);
        if (second) mask(second.open, second.close + 1);
      }
    }
  }

  const out: Word[] = [];
  for (const found of line.matchAll(WORD)) {
    const at = found.index ?? 0;
    const word = found[0];
    // Masked anywhere is masked: a word half inside a command is not a
    // word that was typed.
    let hidden = false;
    for (let i = at; i < at + word.length; i += 1) if (masked[i]) { hidden = true; break; }
    if (hidden) continue;
    if (!worthChecking(word)) continue;
    out.push({ from: at, to: at + word.length, word });
  }
  return out;
}
