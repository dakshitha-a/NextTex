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
import type { Extension } from "@codemirror/state";
import type { Symbols } from "../api";

/** Commands worth offering, with their argument shapes.
 *  `#{n}` marks a field the writer tabs through. */
const COMMANDS: [string, string, string][] = [
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
];

const ENVIRONMENTS = [
  "equation", "align", "gather", "split", "cases", "matrix", "pmatrix",
  "bmatrix", "figure", "figure*", "table", "table*", "tabular", "itemize",
  "enumerate", "description", "abstract", "quote", "quotation", "verbatim",
  "center", "flushleft", "flushright", "minipage", "subfigure", "theorem",
  "proof", "lemma", "definition", "algorithm", "lstlisting", "tikzpicture",
];

const PACKAGES = [
  "amsmath", "amssymb", "amsthm", "graphicx", "booktabs", "siunitx", "geometry",
  "hyperref", "biblatex", "natbib", "microtype", "parskip", "enumitem",
  "xcolor", "tikz", "pgfplots", "caption", "subcaption", "float", "multirow",
  "longtable", "listings", "algorithm2e", "cleveref", "mhchem", "chemfig",
  "fontenc", "inputenc", "lmodern", "setspace", "titlesec", "tocloft", "url",
];

const commandOptions: Completion[] = COMMANDS.map(([name, template, detail]) =>
  snippetCompletion(template, {
    label: `\\${name}`,
    detail: detail || undefined,
    type: "keyword",
  }),
);

/** Which brace-taking command the cursor sits inside, if any. */
function inArgument(before: string): { command: string; typed: string } | null {
  const match = /\\([a-zA-Z@]+)\s*(?:\[[^\]]*\])?\{([^}{]*)$/.exec(before);
  if (!match) return null;
  return { command: match[1], typed: match[2] };
}

export function latexCompletions(symbols: () => Symbols | null): Extension {
  const source = (context: CompletionContext): CompletionResult | null => {
    const line = context.state.doc.lineAt(context.pos);
    const before = line.text.slice(0, context.pos - line.from);
    const found = symbols();

    const argument = inArgument(before);
    if (argument) {
      const from = context.pos - argument.typed.length;
      const { command } = argument;

      if (/^(no|super|paren|text|auto|foot|full)?cite[a-zA-Z]*$/.test(command)) {
        const options = (found?.citations ?? []).map((entry) => ({
          label: entry.key,
          detail: [entry.author, entry.year].filter(Boolean).join(" "),
          info: entry.title || undefined,
          type: "constant",
        }));
        return options.length ? { from, options } : null;
      }

      if (/^(eq|auto|page|c|name|v)?ref$/.test(command)) {
        const options = (found?.labels ?? []).map((entry) => ({
          label: entry.name,
          detail: entry.file.split("/").pop(),
          type: "variable",
        }));
        return options.length ? { from, options } : null;
      }

      if (command === "includegraphics") {
        const options = (found?.images ?? []).map((path) => ({
          label: path, type: "text",
        }));
        return options.length ? { from, options } : null;
      }

      if (command === "input" || command === "include") {
        const options = (found?.texfiles ?? []).map((path) => ({
          label: path.replace(/\.tex$/, ""), detail: path, type: "text",
        }));
        return options.length ? { from, options } : null;
      }

      if (command === "begin" || command === "end") {
        const names = [...ENVIRONMENTS, ...(found?.environments ?? [])];
        return {
          from,
          options: [...new Set(names)].map((name) =>
            command === "begin"
              ? snippetCompletion(`${name}}\n  #{}\n\\end{${name}`, {
                  label: name, type: "type",
                })
              : { label: name, type: "type" },
          ),
        };
      }

      if (command === "usepackage" || command === "RequirePackage") {
        return {
          from,
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
              detail: `yours · ${entry.file.split("/").pop()}`,
              type: "macro",
            },
          )
        : {
            label: `\\${entry.name}`,
            detail: `yours · ${entry.file.split("/").pop()}`,
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

  return autocompletion({
    override: [source],
    activateOnTyping: true,
    icons: false,
    maxRenderedOptions: 60,
    closeOnBlur: true,
  });
}
