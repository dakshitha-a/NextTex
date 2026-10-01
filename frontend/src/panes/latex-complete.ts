/** Autocomplete that knows this document.
 *
 *  A generic list of LaTeX commands is the least useful part of this: what
 *  a writer actually needs is their own labels, their own citation keys,
 *  the figures they uploaded ten minutes ago, and the macros their preamble
 *  defines.  Those come from the server; the command list below is the
 *  floor, not the point.
 */

import {
  autocompletion,
  snippetCompletion,
  type Completion,
  type CompletionContext,
  type CompletionResult,
} from "@codemirror/autocomplete";
import type { EditorState, Extension } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import type { Symbols } from "../api";
import { labelSays } from "./latex-links";
import {
  type CiteScope,
  citeContext,
  citeInsertion,
  documentOf,
  haystack,
  rankCitations,
} from "./cite-match";

/** Commands worth offering, with their argument shapes.
 *  `#{n}` marks a field the writer tabs through. */
export const COMMANDS: [string, string, string][] = [
  // structure
  ["section", "\\section{#{title}}", "a numbered section"],
  ["subsection", "\\subsection{#{title}}", "a numbered subsection"],
  ["subsubsection", "\\subsubsection{#{title}}", ""],
  ["paragraph", "\\paragraph{#{title}}", ""],
  ["chapter", "\\chapter{#{title}}", "book and report classes only"],
  ["part", "\\part{#{title}}", ""],
  ["appendix", "\\appendix", "everything after this is an appendix"],
  ["tableofcontents", "\\tableofcontents", ""],
  ["maketitle", "\\maketitle", ""],
  ["title", "\\title{#{title}}", ""],
  ["author", "\\author{#{name}}", ""],
  ["date", "\\date{#{date}}", ""],
  ["label", "\\label{#{name}}", "name something you can refer back to"],
  ["footnote", "\\footnote{#{text}}", ""],
  ["caption", "\\caption{#{text}}", ""],
  ["clearpage", "\\clearpage", ""],
  ["newpage", "\\newpage", ""],
  ["noindent", "\\noindent", ""],
  // text
  ["textbf", "\\textbf{#{text}}", "bold"],
  ["textit", "\\textit{#{text}}", "italic"],
  ["emph", "\\emph{#{text}}", "emphasis, which nests properly"],
  ["texttt", "\\texttt{#{text}}", "monospace"],
  ["textsc", "\\textsc{#{text}}", "small capitals"],
  ["underline", "\\underline{#{text}}", ""],
  ["textsuperscript", "\\textsuperscript{#{text}}", ""],
  ["textsubscript", "\\textsubscript{#{text}}", ""],
  ["url", "\\url{#{https://}}", ""],
  ["href", "\\href{#{url}}{#{text}}", ""],
  // maths
  ["frac", "\\frac{#{a}}{#{b}}", "a fraction"],
  ["dfrac", "\\dfrac{#{a}}{#{b}}", "a fraction at display size"],
  ["sqrt", "\\sqrt{#{x}}", ""],
  ["sum", "\\sum_{#{i=1}}^{#{n}}", ""],
  ["prod", "\\prod_{#{i=1}}^{#{n}}", ""],
  ["int", "\\int_{#{a}}^{#{b}}", ""],
  ["lim", "\\lim_{#{x \\to 0}}", ""],
  ["partial", "\\partial", ""],
  ["nabla", "\\nabla", ""],
  ["infty", "\\infty", ""],
  ["hbar", "\\hbar", ""],
  ["langle", "\\langle #{x} \\rangle", ""],
  ["mathrm", "\\mathrm{#{text}}", "upright, for units and operators"],
  ["mathbf", "\\mathbf{#{x}}", ""],
  ["mathcal", "\\mathcal{#{H}}", ""],
  ["hat", "\\hat{#{H}}", ""],
  ["vec", "\\vec{#{r}}", ""],
  ["dot", "\\dot{#{x}}", ""],
  ["bar", "\\bar{#{x}}", ""],
  ["tilde", "\\tilde{#{x}}", ""],
  ["left", "\\left( #{x} \\right)", "brackets that grow"],
  ["text", "\\text{#{words}}", "words inside maths"],
  ["alpha", "\\alpha", ""], ["beta", "\\beta", ""], ["gamma", "\\gamma", ""],
  ["delta", "\\delta", ""], ["Delta", "\\Delta", ""], ["epsilon", "\\epsilon", ""],
  ["theta", "\\theta", ""], ["lambda", "\\lambda", ""], ["mu", "\\mu", ""],
  ["nu", "\\nu", ""], ["pi", "\\pi", ""], ["rho", "\\rho", ""],
  ["sigma", "\\sigma", ""], ["tau", "\\tau", ""], ["phi", "\\phi", ""],
  ["chi", "\\chi", ""], ["psi", "\\psi", ""], ["Psi", "\\Psi", ""],
  ["omega", "\\omega", ""], ["Omega", "\\Omega", ""],
  ["approx", "\\approx", ""], ["neq", "\\neq", ""], ["leq", "\\leq", ""],
  ["geq", "\\geq", ""], ["times", "\\times", ""], ["cdot", "\\cdot", ""],
  ["rightarrow", "\\rightarrow", ""], ["to", "\\to", ""],
  // figures, tables, references
  ["includegraphics", "\\includegraphics[width=#{0.8}\\linewidth]{#{path}}", ""],
  ["ref", "\\ref{#{label}}", ""],
  ["eqref", "\\eqref{#{label}}", "an equation number in brackets"],
  ["autoref", "\\autoref{#{label}}", "names the kind of thing too"],
  ["pageref", "\\pageref{#{label}}", ""],
  ["cite", "\\cite{#{key}}", ""],
  ["citep", "\\citep{#{key}}", "a parenthetical citation"],
  ["textcite", "\\textcite{#{key}}", "the author's name in the sentence"],
  ["toprule", "\\toprule", "booktabs"],
  ["midrule", "\\midrule", "booktabs"],
  ["bottomrule", "\\bottomrule", "booktabs"],
  ["centering", "\\centering", ""],
  ["SI", "\\SI{#{2.7}}{#{\\electronvolt}}", "a number with units, siunitx"],
  ["si", "\\si{#{\\electronvolt}}", "units on their own, siunitx"],
  // preamble
  ["usepackage", "\\usepackage{#{name}}", ""],
  ["documentclass", "\\documentclass[#{11pt}]{#{article}}", ""],
  ["newcommand", "\\newcommand{\\#{name}}{#{definition}}", ""],
  ["input", "\\input{#{file}}", ""],
  ["include", "\\include{#{file}}", "a chapter, on its own page"],
  ["bibliography", "\\printbibliography", ""],
  // Added after a writer reached for `\\textcolor` and was offered nothing.
  // The list is the floor and not the point, but a floor with holes in it
  // reads as a feature that does not work rather than as a deliberate
  // shortlist, and colour, spacing and cross-referencing are not exotic.
  // colour
  ["textcolor", "\\textcolor{#{red}}{#{text}}", "coloured text, xcolor"],
  ["color", "\\color{#{red}}", "everything after this, xcolor"],
  ["colorbox", "\\colorbox{#{yellow}}{#{text}}", "xcolor"],
  ["definecolor", "\\definecolor{#{name}}{#{RGB}}{#{0,0,0}}", "xcolor"],
  // spacing and breaks
  ["hspace", "\\hspace{#{1em}}", ""],
  ["vspace", "\\vspace{#{1em}}", ""],
  ["quad", "\\quad", ""],
  ["qquad", "\\qquad", ""],
  ["hfill", "\\hfill", "push what follows to the right"],
  ["vfill", "\\vfill", ""],
  ["smallskip", "\\smallskip", ""],
  ["medskip", "\\medskip", ""],
  ["bigskip", "\\bigskip", ""],
  ["newline", "\\newline", ""],
  ["linebreak", "\\linebreak", ""],
  ["pagebreak", "\\pagebreak", ""],
  ["item", "\\item ", ""],
  ["today", "\\today", ""],
  ["mbox", "\\mbox{#{text}}", "text that will not be broken"],
  ["verb", "\\verb|#{code}|", "literal, inline"],
  ["textnormal", "\\textnormal{#{text}}", ""],
  ["textsl", "\\textsl{#{text}}", "slanted"],
  // more maths
  ["boldsymbol", "\\boldsymbol{#{x}}", "bold in maths"],
  ["mathbb", "\\mathbb{#{R}}", "blackboard bold"],
  ["mathfrak", "\\mathfrak{#{g}}", ""],
  ["operatorname", "\\operatorname{#{tr}}", "an operator name, upright"],
  ["overline", "\\overline{#{x}}", ""],
  ["underbrace", "\\underbrace{#{x}}_{#{note}}", ""],
  ["overbrace", "\\overbrace{#{x}}^{#{note}}", ""],
  ["binom", "\\binom{#{n}}{#{k}}", ""],
  ["displaystyle", "\\displaystyle", ""],
  ["pm", "\\pm", ""], ["mp", "\\mp", ""],
  ["equiv", "\\equiv", ""], ["propto", "\\propto", ""],
  ["sim", "\\sim", ""], ["simeq", "\\simeq", ""],
  ["ll", "\\ll", ""], ["gg", "\\gg", ""],
  ["in", "\\in", ""], ["notin", "\\notin", ""],
  ["subset", "\\subset", ""], ["subseteq", "\\subseteq", ""],
  ["cup", "\\cup", ""], ["cap", "\\cap", ""],
  ["forall", "\\forall", ""], ["exists", "\\exists", ""],
  ["ldots", "\\ldots", ""], ["cdots", "\\cdots", ""],
  ["leftarrow", "\\leftarrow", ""], ["Rightarrow", "\\Rightarrow", ""],
  ["Leftrightarrow", "\\Leftrightarrow", ""], ["mapsto", "\\mapsto", ""],
  // the Greek letters the list was missing
  ["zeta", "\\zeta", ""], ["eta", "\\eta", ""], ["iota", "\\iota", ""],
  ["kappa", "\\kappa", ""], ["xi", "\\xi", ""], ["upsilon", "\\upsilon", ""],
  ["varepsilon", "\\varepsilon", ""], ["varphi", "\\varphi", ""],
  ["vartheta", "\\vartheta", ""],
  ["Gamma", "\\Gamma", ""], ["Theta", "\\Theta", ""],
  ["Lambda", "\\Lambda", ""], ["Xi", "\\Xi", ""], ["Pi", "\\Pi", ""],
  ["Sigma", "\\Sigma", ""], ["Upsilon", "\\Upsilon", ""], ["Phi", "\\Phi", ""],
  // cross-referencing and citations
  ["cref", "\\cref{#{label}}", "cleveref, names the kind for you"],
  ["Cref", "\\Cref{#{label}}", "cleveref, capitalised"],
  ["citet", "\\citet{#{key}}", "the author's name in the sentence"],
  ["parencite", "\\parencite{#{key}}", "biblatex"],
  ["footcite", "\\footcite{#{key}}", "biblatex, in a footnote"],
  ["nocite", "\\nocite{#{key}}", "in the bibliography, uncited"],
  ["addbibresource", "\\addbibresource{#{references.bib}}", "biblatex"],
  ["bibliographystyle", "\\bibliographystyle{#{plain}}", "natbib"],
  // tables and boxes
  ["hline", "\\hline", ""],
  ["cline", "\\cline{#{2-3}}", ""],
  ["multicolumn", "\\multicolumn{#{2}}{#{c}}{#{text}}", ""],
  ["multirow", "\\multirow{#{2}}{#{*}}{#{text}}", ""],
  ["resizebox", "\\resizebox{\\linewidth}{!}{#{content}}", ""],
  // preamble
  ["setlength", "\\setlength{\\#{parindent}}{#{0pt}}", ""],
  ["renewcommand", "\\renewcommand{\\#{name}}{#{definition}}", ""],
  ["DeclareMathOperator", "\\DeclareMathOperator{\\#{tr}}{#{tr}}", ""],
  ["newtheorem", "\\newtheorem{#{theorem}}{#{Theorem}}", ""],
  ["graphicspath", "\\graphicspath{{#{figures/}}}", ""],
  ["linespread", "\\linespread{#{1.5}}", ""],
  ["pagestyle", "\\pagestyle{#{plain}}", ""],
];

const ENVIRONMENTS = [
  "equation", "align", "gather", "split", "cases", "matrix", "pmatrix",
  "bmatrix", "figure", "figure*", "table", "table*", "tabular", "itemize",
  "enumerate", "description", "abstract", "quote", "quotation", "verbatim",
  "center", "flushleft", "flushright", "minipage", "subfigure", "theorem",
  "proof", "lemma", "definition", "algorithm", "lstlisting", "tikzpicture",
  "equation*", "align*", "gather*", "multline", "subequations", "longtable",
  "tabularx", "thebibliography", "corollary", "proposition", "remark",
  "example", "landscape", "adjustbox",
];

const PACKAGES = [
  "amsmath", "amssymb", "amsthm", "graphicx", "booktabs", "siunitx", "geometry",
  "hyperref", "biblatex", "natbib", "microtype", "parskip", "enumitem",
  "xcolor", "tikz", "pgfplots", "caption", "subcaption", "float", "multirow",
  "longtable", "listings", "algorithm2e", "cleveref", "mhchem", "chemfig",
  "fontenc", "inputenc", "lmodern", "setspace", "titlesec", "tocloft", "url",
  "mathtools", "physics", "bm", "array", "tabularx", "adjustbox", "fancyhdr",
  "csquotes", "xspace", "todonotes", "lipsum", "appendix", "acronym",
];

const commandOptions: Completion[] = COMMANDS.map(([name, template, detail]) =>
  snippetCompletion(template, {
    label: `\\${name}`,
    detail: detail || undefined,
    type: "keyword",
  }),
);

/** Which brace-taking command the cursor sits inside, if any.  Two
 *  optional arguments at most, biblatex's `\cite[see][12]{`, which one
 *  used to hide from completion. */
function inArgument(before: string): { command: string; typed: string } | null {
  const match = /\\([a-zA-Z@]+)\s*(?:\[[^\]]*\]\s*){0,2}\{([^}{]*)$/.exec(before);
  if (!match) return null;
  return { command: match[1], typed: match[2] };
}

/** Put the chosen name in, close the brace if it is open, and leave the
 *  caret after it.  Accepting a label used to leave `\ref{sec:intro` with
 *  its brace open, so whatever the writer typed next went into the
 *  argument, and an unclosed brace in a reference is a fatal error (Q-068).
 *  A brace already there is stepped over rather than doubled. */
function closing(text: string) {
  return (view: EditorView, _completion: Completion, from: number, to: number) => {
    const shut = view.state.sliceDoc(to, to + 1) === "}";
    view.dispatch({
      changes: { from, to, insert: shut ? text : `${text}}` },
      selection: { anchor: from + text.length + 1 },
      userEvent: "input.complete",
    });
  };
}

/** While the cursor is still inside the same braces, the list CodeMirror
 *  already has is still the right list -- it filters it itself.  Without
 *  this the source ran again on every keystroke and rebuilt the whole list
 *  each time.  Citations rank their own list instead; see `citations`. */
const INSIDE_BRACES = /^[^}{]*$/;

/** Every command whose argument is a list of citation keys. */
const CITE = /^(no|super|paren|text|auto|foot|full)?cite[a-zA-Z]*$/;

/** How far a citation list is followed onto other lines: twenty lines, two
 *  thousand characters, and never past a blank line, so a brace pages away
 *  costs nothing and a paragraph break always ends the search. */
const REACH_LINES = 20;
const REACH_CHARS = 2000;

/** A line, or the part of one, that holds only keys and the commas between
 *  them.  Prose fails it, since its words are parted by spaces rather than
 *  commas, and so does anything with a brace, a command or a comment, which
 *  is what keeps a list from being read into the paragraph around it. */
const KEYS = /^\s*,?\s*[\w:.+\-/@]*(?:\s*,\s*[\w:.+\-/@]*)*\s*$/;

/** The open citation the caret is in when its `\cite{` is on an earlier
 *  line: `typed` is everything from the brace to the caret, newlines and
 *  all, which `citeContext` reads like any list.  A key left unfinished
 *  at the end of the line before, with no comma after it, is not a list
 *  the caret can add to, so it answers nothing. */
export function citeAcross(
  state: EditorState,
  pos: number,
): { command: string; typed: string } | null {
  const line = state.doc.lineAt(pos);
  const head = line.text.slice(0, pos - line.from);
  if (!KEYS.test(head)) return null;
  const between: string[] = [head];
  let reach = head.length;
  for (let n = line.number - 1; n >= Math.max(1, line.number - REACH_LINES); n -= 1) {
    const text = state.doc.line(n).text;
    reach += text.length + 1;
    if (!text.trim() || reach > REACH_CHARS) return null;
    const open = inArgument(text);
    if (open) {
      if (!CITE.test(open.command)) return null;
      const typed = [open.typed, ...between.reverse()].join("\n");
      const last = typed.slice(typed.lastIndexOf(",") + 1);
      return /\S\s*\n/.test(last) ? null : { command: open.command, typed };
    }
    if (!KEYS.test(text)) return null;
    between.push(text);
  }
  return null;
}

/** What follows the caret in a citation list, onto later lines while they
 *  hold only keys, up to the line that closes it.  What `citeContext` and
 *  `citeInsertion` read, so a key already on the next line is left out of
 *  the list and a closing brace there is not doubled. */
export function citeAfter(state: EditorState, pos: number): string {
  const line = state.doc.lineAt(pos);
  let after = line.text.slice(pos - line.from);
  if (/[{}\\%]/.test(after) || !KEYS.test(after)) return after;
  const last = Math.min(state.doc.lines, line.number + REACH_LINES);
  for (let n = line.number + 1; n <= last; n += 1) {
    const text = state.doc.line(n).text;
    if (!text.trim() || after.length + text.length > REACH_CHARS) break;
    const close = text.indexOf("}");
    if (close >= 0) {
      if (KEYS.test(text.slice(0, close))) after += `\n${text}`;
      break;
    }
    if (!KEYS.test(text)) break;
    after += `\n${text}`;
  }
  return after;
}

/** The open argument at the caret, on this line or, for a citation list,
 *  begun on an earlier one. */
function argumentAt(state: EditorState, pos: number): { command: string; typed: string } | null {
  const line = state.doc.lineAt(pos);
  return inArgument(line.text.slice(0, pos - line.from)) ?? citeAcross(state, pos);
}

/** What the completion list would be at one position.
 *
 *  Separated from the extension so it can be asked a question without a
 *  DOM, an editor or a keystroke: everything interesting about completion
 *  is deciding *which* list, and that is pure.
 */
export function latexSource(
  symbols: () => Symbols | null,
  scope?: () => CiteScope | null,
): (context: CompletionContext) => CompletionResult | null {
  return (context: CompletionContext): CompletionResult | null => {
    const line = context.state.doc.lineAt(context.pos);
    const before = line.text.slice(0, context.pos - line.from);
    const found = symbols();

    const argument = inArgument(before) ?? citeAcross(context.state, context.pos);
    if (argument) {
      const from = context.pos - argument.typed.length;
      const { command } = argument;

      if (CITE.test(command)) {
        return citations(context, argument.typed, found, scope?.() ?? null);
      }

      if (/^(eq|auto|page|c|name|v)?ref$/.test(command)) {
        // What the reference will say, once a build has said it, is
        // worth more beside the name than the file it is in.
        const options = (found?.labels ?? []).map((entry) => ({
          label: entry.name,
          apply: closing(entry.name),
          detail: labelSays(entry) ?? entry.file.split("/").pop(),
          type: "variable",
        }));
        return options.length
          ? { from, options, validFor: INSIDE_BRACES }
          : null;
      }

      if (command === "includegraphics") {
        const options = (found?.images ?? []).map((path) => ({
          label: path, apply: closing(path), type: "text",
        }));
        return options.length
          ? { from, options, validFor: INSIDE_BRACES }
          : null;
      }

      if (command === "input" || command === "include") {
        const options = (found?.texfiles ?? []).map((path) => ({
          label: path.replace(/\.tex$/, ""), apply: closing(path.replace(/\.tex$/, "")),
          detail: path, type: "text",
        }));
        return options.length
          ? { from, options, validFor: INSIDE_BRACES }
          : null;
      }

      if (command === "begin" || command === "end") {
        const names = [...ENVIRONMENTS, ...(found?.environments ?? [])];
        return {
          from,
          validFor: INSIDE_BRACES,
          options: [...new Set(names)].map((name) =>
            command === "begin"
              ? snippetCompletion(`${name}}\n  #{}\n\\end{${name}`, {
                  label: name, type: "type",
                })
              : { label: name, type: "type" },
          ),
        };
      }

      if (command === "bibliographystyle") {
        const options = (found?.styles ?? []).map((name) => ({ label: name, type: "constant" }));
        return options.length ? { from, options, validFor: INSIDE_BRACES } : null;
      }

      if (command === "usepackage" || command === "RequirePackage") {
        return {
          from,
          validFor: INSIDE_BRACES,
          options: PACKAGES.map((name) => ({ label: name, type: "namespace" })),
        };
      }
      return null;
    }

    // A backslash starts a command.
    const command = /\\([a-zA-Z@]*)$/.exec(before);
    if (!command) return null;
    const own: Completion[] = (found?.commands ?? []).map((entry) =>
      entry.args > 0
        ? snippetCompletion(
            `\\${entry.name}` + "{#{}}".repeat(entry.args),
            {
              label: `\\${entry.name}`,
              detail: `yours, ${entry.file.split("/").pop()}`,
              type: "macro",
            },
          )
        : {
            label: `\\${entry.name}`,
            detail: `yours, ${entry.file.split("/").pop()}`,
            type: "macro",
            apply: `\\${entry.name}`,
          },
    );
    return {
      from: context.pos - command[1].length - 1,
      options: [...own, ...commandOptions],
      validFor: /^\\[a-zA-Z@]*$/,
    };
  };
}

export function latexCompletions(
  symbols: () => Symbols | null,
  scope?: () => CiteScope | null,
): Extension {
  return autocompletion({
    override: [latexSource(symbols, scope)],
    activateOnTyping: true,
    // The kind column: a glyph per kind, drawn by styles.css.
    icons: true,
    maxRenderedOptions: 60,
    closeOnBlur: true,
    // A citation's detail column, drawn here rather than from `detail` so
    // the letters an author, a year or a title word matched are marked
    // the way the key's are.  Every other option keeps its own `detail`.
    addToOptions: [{ position: 80, render: citeDetail }],
  });
}

/** What a citation row's detail column says and which letters matched,
 *  written when the list is made and read when a row is drawn. */
const DETAIL = new WeakMap<Completion, { text: string; marks: number[] }>();
/** The key's matched letters, for `getMatch`. */
const LABEL = new WeakMap<Completion, number[]>();

function citeDetail(completion: Completion): Node | null {
  const detail = DETAIL.get(completion);
  if (!detail || !detail.text) return null;
  const span = document.createElement("span");
  span.className = "cm-completionDetail";
  let at = 0;
  for (let i = 0; i < detail.marks.length; i += 2) {
    const [from, to] = [detail.marks[i], detail.marks[i + 1]];
    if (from > at) span.append(detail.text.slice(at, from));
    const mark = document.createElement("span");
    mark.className = "cm-completionMatchedText";
    mark.textContent = detail.text.slice(from, to);
    span.append(mark);
    at = to;
  }
  if (at < detail.text.length) span.append(detail.text.slice(at));
  return span;
}

/** The citation list at the caret: the key after the last comma is the
 *  one being completed, the keys already in the braces are left out, and
 *  the list is ranked here rather than filtered by CodeMirror, which only
 *  knows the key.  `update` answers each keystroke from the same ranking,
 *  so the list never shows a stale moment, and a comma starts the next
 *  key with a list of its own. */
function citations(
  context: CompletionContext,
  typed: string,
  found: Symbols | null,
  scope: CiteScope | null,
): CompletionResult | null {
  const all = found?.citations ?? [];
  if (!all.length) return null;
  const after = citeAfter(context.state, context.pos);
  const { segment, back, forward, excluded } = citeContext(typed, after);
  const document = scope
    ? documentOf(scope.path, scope.owners, scope.previews, scope.activePreview)
    : "";
  const entries = haystack(all, scope?.owners ?? {}, document);
  const from = context.pos - back;
  const to = context.pos + forward;
  const options = rankCitations(entries, segment, excluded).map((hit): Completion => {
    const key = hit.citation.key;
    const option: Completion = {
      label: key,
      info: hit.citation.title || undefined,
      type: "constant",
      apply: (view: EditorView, _completion: Completion, start: number, end: number) => {
        const { insert, caret } = citeInsertion(citeAfter(view.state, end), key);
        view.dispatch({
          changes: { from: start, to: end, insert },
          selection: { anchor: start + caret },
          userEvent: "input.complete",
        });
      },
    };
    DETAIL.set(option, { text: hit.detail, marks: hit.marks });
    LABEL.set(option, hit.label);
    return option;
  });
  if (!options.length) return null;
  return {
    from,
    to,
    options,
    filter: false,
    getMatch: (option) => LABEL.get(option) ?? [],
    update: (_current, _from, _to, next) => {
      const now = argumentAt(next.state, next.pos);
      return now && CITE.test(now.command) ? citations(next, now.typed, found, scope) : null;
    },
  };
}
