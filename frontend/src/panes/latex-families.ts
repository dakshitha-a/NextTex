// Which family a control sequence belongs to.
//
// The `stex` mode hands back one token type for every command in the
// document -- `\section`, `\cite` and `\usepackage` are all a "tag" -- so a
// highlight style keyed on token types cannot tell them apart however many
// colours it is given.  Telling them apart is the whole point of colouring
// them, so the family is decided here, by name, and applied as a decoration
// over the visible lines.
//
// The lists are deliberately finite.  Anything not named falls through to
// the ordinary command styling, which is what every package-specific macro
// in a real preamble should do: guessing a family from the shape of a name
// would put `\mycommand` in a colour that means something it does not.

export type Family = "structure" | "env" | "math" | "cite" | "preamble";

/** Where you are in the document. */
const STRUCTURE = [
  "part", "chapter", "section", "subsection", "subsubsection",
  "paragraph", "subparagraph", "title", "author", "date", "thanks",
  "maketitle", "tableofcontents", "listoffigures", "listoftables",
  "appendix", "frontmatter", "mainmatter", "backmatter",
];

/** Environments, and the things that only ever appear inside one. */
const ENV = [
  "begin", "end", "item", "caption", "captionsetup", "includegraphics",
  "hline", "cline", "toprule", "midrule", "bottomrule", "multicolumn",
  "multirow", "centering", "raggedright", "raggedleft", "rowcolor",
  "cellcolor", "resizebox", "subfloat", "subfigure", "adjustbox",
  "centerline", "columnwidth", "textwidth", "linewidth", "tabularnewline",
];

/** Mathematics: the operators, the accents and the Greek. */
const MATH = [
  "frac", "dfrac", "tfrac", "sqrt", "sum", "prod", "int", "iint", "iiint",
  "oint", "lim", "limits", "nolimits", "infty", "partial", "nabla",
  "cdot", "cdots", "ldots", "dots", "vdots", "ddots", "times", "div",
  "pm", "mp", "leq", "geq", "neq", "approx", "equiv", "sim", "simeq",
  "propto", "ll", "gg", "subset", "supset", "in", "notin", "forall",
  "exists", "rightarrow", "leftarrow", "leftrightarrow", "Rightarrow",
  "Leftarrow", "Leftrightarrow", "to", "mapsto", "langle", "rangle",
  "lvert", "rvert", "lVert", "rVert", "left", "right", "big", "Big",
  "bigg", "Bigg", "mathrm", "mathbf", "mathcal", "mathbb", "mathit",
  "mathsf", "mathtt", "mathfrak", "operatorname", "hat", "vec", "bar",
  "tilde", "dot", "ddot", "overline", "underline", "overbrace",
  "underbrace", "quad", "qquad", "nonumber", "notag", "substack",
  "alpha", "beta", "gamma", "delta", "epsilon", "varepsilon", "zeta",
  "eta", "theta", "vartheta", "iota", "kappa", "lambda", "mu", "nu",
  "xi", "pi", "varpi", "rho", "varrho", "sigma", "varsigma", "tau",
  "upsilon", "phi", "varphi", "chi", "psi", "omega",
  "Gamma", "Delta", "Theta", "Lambda", "Xi", "Pi", "Sigma", "Upsilon",
  "Phi", "Psi", "Omega",
];

/** Everything that points somewhere else. */
const CITE = [
  "cite", "citep", "citet", "citealp", "citealt", "citeauthor", "citeyear",
  "citenum", "textcite", "parencite", "autocite", "footcite", "supercite",
  "ref", "eqref", "autoref", "cref", "Cref", "vref", "pageref", "nameref",
  "label", "bibliography", "bibliographystyle", "printbibliography",
  "addbibresource", "footnote", "footnotemark", "footnotetext",
  "url", "href", "doi", "hyperref",
];

/** Setup: the part of the file that is not the writing. */
const PREAMBLE = [
  "documentclass", "usepackage", "RequirePackage", "newcommand",
  "renewcommand", "providecommand", "DeclareMathOperator", "newenvironment",
  "renewenvironment", "newtheorem", "setlength", "addtolength",
  "definecolor", "geometry", "input", "include", "includeonly",
  "graphicspath", "pagestyle", "thispagestyle", "newcolumntype",
  "setcounter", "addtocounter", "numberwithin", "AtBeginDocument",
  "makeatletter", "makeatother", "usetikzlibrary", "hypersetup",
  "bibliographystyle", "linespread", "pagenumbering", "newpage",
  "clearpage", "cleardoublepage", "pagebreak",
];

const BY_NAME = new Map<string, Family>();
for (const [family, names] of [
  ["structure", STRUCTURE], ["env", ENV], ["math", MATH],
  ["cite", CITE], ["preamble", PREAMBLE],
] as [Family, string[]][]) {
  // First list wins, so a name in two lists keeps the family it was given
  // first rather than silently depending on declaration order later.
  for (const name of names) if (!BY_NAME.has(name)) BY_NAME.set(name, family);
}

/** Environments whose contents are mathematics, so `\begin{align}` reads as
 *  an equation rather than as any other environment. */
const MATH_ENVIRONMENTS = new Set([
  "equation", "align", "alignat", "gather", "multline", "split", "cases",
  "eqnarray", "displaymath", "math", "aligned", "gathered", "alignedat",
  "IEEEeqnarray", "dmath", "array", "smallmatrix", "matrix", "pmatrix",
  "bmatrix", "vmatrix", "Vmatrix", "Bmatrix",
]);

/** The family of a command, by name and without its backslash, or null when
 *  it is not one of the ones worth colouring. */
export function familyOf(command: string): Family | null {
  // `\section*` is `\section`; the star is not part of the name.
  const name = command.endsWith("*") ? command.slice(0, -1) : command;
  return BY_NAME.get(name) ?? null;
}

/** The family of an environment named in `\begin{...}` or `\end{...}`. */
export function familyOfEnvironment(name: string): Family {
  const bare = name.endsWith("*") ? name.slice(0, -1) : name;
  return MATH_ENVIRONMENTS.has(bare) ? "math" : "env";
}

/** Commands whose first braced argument is a heading, and so is worth
 *  colouring along with the command: it is the line you scan for when you
 *  are looking for where you are.  Named rather than sliced off the list
 *  above, so that adding `\listoffigures` to it cannot quietly change
 *  which commands light up their argument. */
export const TITLED = new Set([
  "part", "chapter", "section", "subsection", "subsubsection",
  "paragraph", "subparagraph", "title",
]);

/** Where a comment starts on this line, or -1.  A `%` escaped with a
 *  backslash is a literal percent sign and does not start one, and a
 *  doubled backslash is a line break rather than an escape. */
export function commentStart(line: string): number {
  for (let i = 0; i < line.length; i += 1) {
    if (line[i] === "\\") { i += 1; continue; }
    if (line[i] === "%") return i;
  }
  return -1;
}

/** The balanced `{...}` beginning at or after `from`, skipping an optional
 *  `[...]` in between, or null when the line does not hold one. */
export function braceAfter(
  text: string,
  from: number,
): { open: number; close: number } | null {
  let i = from;
  while (i < text.length && (text[i] === " " || text[i] === "\t")) i += 1;
  if (text[i] === "[") {
    const shut = text.indexOf("]", i);
    if (shut < 0) return null;
    i = shut + 1;
    while (i < text.length && (text[i] === " " || text[i] === "\t")) i += 1;
  }
  if (text[i] !== "{") return null;
  let depth = 0;
  for (let j = i; j < text.length; j += 1) {
    if (text[j] === "\\") { j += 1; continue; }
    if (text[j] === "{") depth += 1;
    else if (text[j] === "}") {
      depth -= 1;
      if (depth === 0) return { open: i, close: j };
    }
  }
  return null;
}

/** The `$...$` and `$$...$$` spans on one line.
 *
 *  Inline mathematics carries no control sequence at all -- `$S_1$` is three
 *  ordinary characters between two delimiters -- so it is the one part of an
 *  equation that colouring commands by name would miss entirely, and it is
 *  the form most of the mathematics in a paragraph takes.
 *
 *  A `$` opening a span that does not close on the same line is dropped
 *  rather than guessed at: a display that runs over several lines would
 *  otherwise colour everything after it, and being wrong about where the
 *  mathematics ends is worse than leaving it plain.
 */
export function inlineMath(text: string): { from: number; to: number }[] {
  const spans: { from: number; to: number }[] = [];
  let open = -1;
  let openDouble = false;
  for (let i = 0; i < text.length; i += 1) {
    if (text[i] === "\\") { i += 1; continue; }
    if (text[i] !== "$") continue;
    const double = text[i + 1] === "$";
    if (open < 0) {
      open = i;
      openDouble = double;
      if (double) i += 1;
    } else {
      // `$$` closes `$$` and `$` closes `$`; a single dollar inside a
      // display is not the end of it.
      if (openDouble && !double) continue;
      spans.push({ from: open, to: i + (double ? 2 : 1) });
      open = -1;
      if (double) i += 1;
    }
  }
  return spans;
}
