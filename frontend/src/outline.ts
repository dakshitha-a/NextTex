// The table of contents for whatever is in the editor, read straight from
// the source rather than from a compiled .toc file.  A .toc only exists
// after a successful build and lags the text by a whole compile; an outline
// is wanted while the section is still being typed, so this parses the
// buffer itself and costs a single pass over it.
//
// It is deliberately a scanner over the raw string rather than a per-line
// regex: a title can run across lines, a comment can hide a heading, and a
// verbatim block can contain something that looks like one.  All three fall
// out of scanning once, and line numbers stay exact for the jump.

export type HeadingKind =
  | "part"
  | "chapter"
  | "section"
  | "subsection"
  | "subsubsection"
  | "paragraph"
  | "abstract"
  | "file";

export type Heading = {
  kind: HeadingKind;
  /** Nesting depth used for indentation, 0 at the top. */
  level: number;
  title: string;
  /** 1-based, where the command starts. */
  line: number;
  /** Only on `file` entries: the .tex this row opens. */
  path?: string;
  /** Only on `abstract`: the line of its `\end{abstract}`, since an
   *  abstract ends there rather than at the next heading. */
  end?: number;
};

/** Depth of each sectioning command, matching LaTeX's own order. */
const LEVELS: Record<string, number> = {
  part: 0,
  chapter: 1,
  section: 2,
  subsection: 3,
  subsubsection: 4,
  paragraph: 5,
};

/** `\include` and `\input` sit where a chapter would: in a skeleton file
 *  like main.tex they *are* the chapter list, and that is the outline a
 *  writer wants when main.tex is the open document. */
const FILE_LEVEL = 1;

/** Environments whose contents are not LaTeX and must not be read as it. */
const VERBATIM = new Set(["verbatim", "lstlisting", "minted", "comment"]);

/** Commands whose argument is machinery, not words, and is dropped whole. */
const DROPPED = /\\(?:label|footnote|index|thanks|protect|nopagebreak)\s*(?:\{[^{}]*\})?/g;

const ESCAPES: Record<string, string> = {
  "&": "&", "%": "%", $: "$", "#": "#", _: "_", "{": "{", "}": "}",
};

/** What the project's own files say about its commands, which the
 *  outline of one file cannot see: the argumentless macros, written out
 *  in a title (`\Sz{}` is S₀), and the commands that make a heading of
 *  their argument (a class's `\backmatter{Data availability}`). */
export type OutlineContext = {
  macros?: Record<string, string>;
  headings?: Record<string, HeadingKind>;
};

/** The context from the project's command table, as `/symbols` gives it. */
export function contextOf(
  commands: { name: string; args: number; definition?: string }[] | undefined,
): OutlineContext {
  const macros: Record<string, string> = {};
  const headings: Record<string, HeadingKind> = {};
  for (const command of commands ?? []) {
    const body = command.definition;
    if (body === undefined) continue;
    if (command.args === 0 && !body.includes("#")) macros[command.name] = body;
    const wrapped = /\\(part|chapter|section|subsection|subsubsection|paragraph)\*?\s*(?:\[[^\]]*\])?\s*\{\s*#1\s*\}/.exec(body);
    if (command.args === 1 && wrapped) headings[command.name] = wrapped[1] as HeadingKind;
  }
  return { macros, headings };
}

/** Greek letters and the signs a title writes in maths, as set. */
const SIGNS: Record<string, string> = {
  alpha: "α", beta: "β", gamma: "γ", delta: "δ", epsilon: "ε", varepsilon: "ε", zeta: "ζ",
  eta: "η", theta: "θ", vartheta: "θ", iota: "ι", kappa: "κ", lambda: "λ", mu: "μ", nu: "ν",
  xi: "ξ", pi: "π", rho: "ρ", sigma: "σ", tau: "τ", upsilon: "υ", phi: "φ", varphi: "φ",
  chi: "χ", psi: "ψ", omega: "ω", Gamma: "Γ", Delta: "Δ", Theta: "Θ", Lambda: "Λ", Xi: "Ξ",
  Pi: "Π", Sigma: "Σ", Upsilon: "Υ", Phi: "Φ", Psi: "Ψ", Omega: "Ω", pm: "±", mp: "∓",
  times: "×", cdot: "·", cdots: "⋯", ldots: "…", dots: "…", to: "→", rightarrow: "→",
  leftarrow: "←", leftrightarrow: "↔", rightleftharpoons: "⇌", sim: "∼", approx: "≈",
  le: "≤", leq: "≤", ge: "≥", geq: "≥", ne: "≠", neq: "≠", infty: "∞", hbar: "ħ", circ: "∘",
  prime: "′", AA: "Å", deg: "°", degree: "°", nabla: "∇", partial: "∂", langle: "⟨",
  rangle: "⟩", vert: "|", mid: "|", lvert: "|", rvert: "|", cdotp: "·",
};
/** Switches that change the face or size of what follows, setting nothing. */
const SWITCHES = new Set([
  "bf", "it", "rm", "sf", "tt", "em", "sc", "sl", "normalfont", "bfseries", "itshape",
  "rmfamily", "sffamily", "ttfamily", "upshape", "scshape", "tiny", "scriptsize", "footnotesize",
  "small", "normalsize", "large", "Large", "LARGE", "huge", "Huge", "centering", "noindent",
  "newline", "linebreak", "hfill", "protect", "relax", "displaystyle", "textstyle",
]);
const SUB: Record<string, string> = Object.fromEntries(
  [..."0123456789+-=()aehiklmnoprstuvx"].map((c, i) => [c, [..."₀₁₂₃₄₅₆₇₈₉₊₋₌₍₎ₐₑₕᵢₖₗₘₙₒₚᵣₛₜᵤᵥₓ"][i]]),
);
const SUP: Record<string, string> = Object.fromEntries(
  [..."0123456789+-=()in"].map((c, i) => [c, [..."⁰¹²³⁴⁵⁶⁷⁸⁹⁺⁻⁼⁽⁾ⁱⁿ"][i]]),
);
const FACE = /\\(?:mathrm|mathbf|mathit|mathsf|mathtt|mathcal|mathbb|boldsymbol|bm|text|textrm|textit|textbf|textsf|texttt|textup|textnormal|emph|operatorname|ensuremath|mbox|hbox)\s*\*?\s*(?=\{)/;

/** `text` with each command `pattern` finds and its `count` braced
 *  arguments replaced by what `make` makes of them. */
function replaceCommand(text: string, pattern: RegExp, count: number, make: (args: string[]) => string): string {
  for (let pass = 0; pass < 8; pass++) {
    const match = pattern.exec(text);
    if (!match) return text;
    const args: string[] = [];
    let at = match.index + match[0].length;
    for (let k = 0; k < count; k++) {
      while (/\s/.test(text[at] ?? "")) at++;
      const arg = text[at] === "{" ? braced(text, at) : null;
      if (!arg) return text;
      args.push(arg.body);
      at = arg.end + 1;
    }
    text = text.slice(0, match.index) + make(args) + text.slice(at);
  }
  return text;
}

/** Inline maths as the page sets it: Greek as letters, scripts as the
 *  small figures where Unicode has them, faces and spacing gone. */
function maths(body: string): string {
  let text = body.replace(/\\label\s*\{[^{}]*\}/g, "");
  text = replaceCommand(text, FACE, 1, ([arg]) => arg);
  text = text.replace(/\\(?:[,;:!> ]|quad|qquad)/g, "");
  text = text.replace(/\\([a-zA-Z]+)(\s*)/g, (whole, name: string, space: string) =>
    SWITCHES.has(name) ? "" : name in SIGNS ? SIGNS[name] + space : whole);
  for (let pass = 0; pass < 3; pass++) {
    text = text.replace(/([_^])\s*(?:\{([^{}]*)\}|(\\[A-Za-z]+|.))/g, (_m, mark: string, group?: string, one?: string) => {
      const inner = (group ?? one ?? "").replace(/ /g, "");
      const table = mark === "_" ? SUB : SUP;
      return inner && [...inner].every((c) => c in table) ? [...inner].map((c) => table[c]).join("") : inner;
    });
  }
  return text.replace(/\s+/g, " ").trim();
}

/** `raw` with the project's argumentless macros written out. */
function expand(raw: string, macros: Record<string, string> | undefined): string {
  const names = Object.keys(macros ?? {});
  if (!names.length) return raw;
  const escaped = names.sort((a, b) => b.length - a.length).map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const pattern = new RegExp(`\\\\(${escaped.join("|")})(?![A-Za-z])(\\s*\\{\\})?`, "g");
  for (let pass = 0; pass < 4; pass++) {
    const next = raw.replace(pattern, (_m, name: string) => macros![name]);
    if (next === raw) break;
    raw = next;
  }
  return raw;
}

/** Turn a raw LaTeX title into something readable in a 240px rail: the
 *  project's macros written out, a `\texorpdfstring`'s TeX form once, and
 *  maths as the page sets it, `CH$_4$` as CH₄. */
export function clean(raw: string, context: OutlineContext = {}): string {
  raw = expand(raw, context.macros);
  raw = replaceCommand(raw, /\\texorpdfstring\s*(?=\{)/, 2, ([tex]) => tex);
  raw = replaceCommand(raw, /\\ensuremath\s*(?=\{)/, 1, ([body]) => `$${body}$`).replace(/\$\$/g, "");
  raw = raw.replace(/(?<!\\)\$([^$]*)\$|\\\((.*?)\\\)/g, (_m, a?: string, b?: string) => maths(a ?? b ?? ""));
  let text = raw.replace(DROPPED, " ");
  text = text.replace(/\\\\/g, " ");
  // Held aside until the end: the steps below take `$`, `{` and `}` for
  // markup, and an escaped one is a character of the title.
  text = text.replace(/\\([&%$#_{}])/g, (_m, c: string) => ESCAPED[c] ?? ESCAPES[c] ?? c);
  // `\textit{x}` and friends are formatting around the words; keep the
  // words.  Run it a few times so one nested inside another unwraps too.
  // The group must have something in it: `\ONP{}` is not an empty command,
  // it is a command plus the idiom that keeps the space after it.
  for (let pass = 0; pass < 4; pass++) {
    const next = text.replace(/\\[a-zA-Z]+\s*\*?\s*\{([^{}]+)\}/g, "$1");
    if (next === text) break;
    text = next;
  }
  // A macro with no argument still stands for a word -- `\ONP` is the
  // molecule -- so keep its name rather than leaving a hole; a sign is the
  // sign, and a switch of face sets nothing.
  text = text.replace(/\\([a-zA-Z]+)/g, (_m, name: string) => (SWITCHES.has(name) ? "" : SIGNS[name] ?? name));
  text = text.replace(/[{}$~]/g, " ");
  text = text.replace(/([([])\s+/g, "$1").replace(/\s+([)\]])/g, "$1");
  // The dashes as the reader will see them typeset.  `Born--Oppenheimer` is
  // one name in the source and should read as one name in the rail.
  text = text.replace(/---/g, "\u2014").replace(/--/g, "\u2013");
  text = text.replace(/``|''/g, '"');
  text = text.replace(/[\uE000-\uE002]/g, (c) => HELD[c]);
  return text.replace(/\s+/g, " ").trim();
}

/** An escaped `$`, `{` or `}`, held as a private character while the
 *  markup is taken out. */
const ESCAPED: Record<string, string> = { $: "\uE000", "{": "\uE001", "}": "\uE002" };
const HELD: Record<string, string> = { "\uE000": "$", "\uE001": "{", "\uE002": "}" };

/** Read the balanced `{...}` starting at `open`, or null if it never closes. */
function braced(text: string, open: number): { body: string; end: number } | null {
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    const c = text[i];
    if (c === "\\") { i++; continue; }
    if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0) return { body: text.slice(open + 1, i), end: i };
    }
  }
  return null;
}

/** Step past whitespace, then an optional `[...]`, to the argument's `{`. */
function argumentAt(text: string, from: number): number | null {
  let i = from;
  while (i < text.length && /\s/.test(text[i])) i++;
  if (text[i] === "[") {
    let depth = 0;
    for (; i < text.length; i++) {
      if (text[i] === "[") depth++;
      else if (text[i] === "]") { depth--; if (!depth) { i++; break; } }
    }
    while (i < text.length && /\s/.test(text[i])) i++;
  }
  return text[i] === "{" ? i : null;
}

/** A file argument may be written with or without its extension. */
function texPath(argument: string): string {
  const path = argument.trim();
  if (!path) return path;
  return /\.[a-zA-Z]+$/.test(path) ? path : `${path}.tex`;
}

export function outline(text: string, context: OutlineContext = {}): Heading[] {
  const found: Heading[] = [];
  // `\input{preamble/macros}` above `\begin{document}` is machinery, not a
  // chapter.  A dissertation's main.tex loads two of them, and they were
  // heading its table of contents.  Recorded rather than skipped outright,
  // because a chapter file has no `\begin{document}` at all and its inputs
  // are part of its outline.
  const preamble: number[] = [];
  let started = false;
  let line = 1;

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === "\n") { line++; continue; }
    // A commented-out heading is not a heading.  `\%` is a percent sign.
    if (c === "%") {
      while (i < text.length && text[i] !== "\n") i++;
      i--;
      continue;
    }
    if (c !== "\\") continue;

    const word = /^[a-zA-Z]+/.exec(text.slice(i + 1, i + 24));
    if (!word) { i++; continue; }
    const name = word[0];
    const after = i + 1 + name.length;

    if (name === "begin") {
      const open = argumentAt(text, after);
      const arg = open === null ? null : braced(text, open);
      if (arg && arg.body.trim() === "document") started = true;
      // The abstract is a place in the document, and the one a word limit
      // most often applies to, so it is a row; its level is set at the end,
      // beside the shallowest heading the file has.
      if (arg && arg.body.trim() === "abstract") {
        const close = text.indexOf("\\end{abstract}", arg.end);
        let end = line;
        if (close !== -1) for (let j = i; j < close; j++) if (text[j] === "\n") end++;
        found.push({ kind: "abstract", level: 0, title: "Abstract", line, end: close === -1 ? undefined : end });
      }
      if (arg && VERBATIM.has(arg.body.trim())) {
        // Jump the whole block; anything inside it is not source.
        const close = text.indexOf(`\\end{${arg.body.trim()}}`, arg.end);
        const to = close === -1 ? text.length : close;
        for (let j = i; j < to; j++) if (text[j] === "\n") line++;
        i = to - 1;
        continue;
      }
      i = after - 1;
      continue;
    }

    if (name === "include" || name === "input") {
      const open = argumentAt(text, after);
      const arg = open === null ? null : braced(text, open);
      if (!arg) { i = after - 1; continue; }
      // A folder kept in a macro, `\input{\figdir/pipeline}`, is the
      // folder the macro names.
      const path = texPath(expand(arg.body, context.macros));
      if (path) {
        const label = path.replace(/^.*\//, "").replace(/\.tex$/, "");
        if (!started) preamble.push(found.length);
        found.push({ kind: "file", level: FILE_LEVEL, title: label, line, path });
      }
      for (let j = i; j <= arg.end; j++) if (text[j] === "\n") line++;
      i = arg.end;
      continue;
    }

    // A sectioning command, or the project's own command that makes one.
    const kind: HeadingKind | undefined = name in LEVELS ? (name as HeadingKind) : context.headings?.[name];
    const level = kind === undefined ? undefined : LEVELS[kind];
    if (level === undefined) { i = after - 1; continue; }

    // `\section*` is unnumbered but still a place in the document.
    let cursor = after;
    while (cursor < text.length && /\s/.test(text[cursor])) cursor++;
    if (text[cursor] === "*") cursor++;
    const open = argumentAt(text, cursor);
    const arg = open === null ? null : braced(text, open);
    if (!arg) { i = after - 1; continue; }

    const title = clean(arg.body, context);
    // A heading above `\begin{document}` is in a definition, the body of
    // a command that makes one, and not a place in the document.
    if (!started) preamble.push(found.length);
    found.push({ kind: kind as HeadingKind, level, title: title || "(untitled)", line });
    for (let j = i; j <= arg.end; j++) if (text[j] === "\n") line++;
    i = arg.end;
  }

  // Only once the document is known to begin: otherwise every included
  // file in a chapter would be dropped. Dropped before the levels are
  // set, so a definition's heading does not set the drawer's left edge.
  if (started && preamble.length) {
    const drop = new Set(preamble);
    const kept = found.filter((_, index) => !drop.has(index));
    found.length = 0;
    found.push(...kept);
  }

  const levels = found.filter((h) => h.kind !== "abstract" && h.kind !== "file").map((h) => h.level);
  const top = levels.length ? Math.min(...levels) : LEVELS.section;
  for (const heading of found) if (heading.kind === "abstract") heading.level = top;
  // An included file sits inside the heading it follows, a level below it,
  // and at the shallowest heading's level before any.  Left at the
  // chapter's level, an `\input` of a table in a file of subsections set
  // the drawer's left edge, so every heading stood two steps in, and the
  // heading after the table read as a child of it (seen in the writer's
  // methylamine chapter, 2 October 2026).  A skeleton file of inputs alone
  // keeps them at `FILE_LEVEL`.
  if (levels.length) {
    let above: number | null = null;
    for (const heading of found) {
      if (heading.kind === "file") heading.level = above === null ? top : above + 1;
      else if (heading.kind !== "abstract") above = heading.level;
    }
  }

  return found;
}

/** Which heading the caret is sitting under: the last one at or above it.
 *  Returns -1 before the first heading, which is a real place to be. */
export function headingAt(headings: Heading[], line: number): number {
  let index = -1;
  for (let i = 0; i < headings.length; i++) {
    if (headings[i].line <= line) index = i;
    else break;
  }
  return index;
}

/** Whether two outlines describe the same document.  Typing prose changes
 *  the text on every keystroke but the section list only rarely, so this
 *  keeps the panel from re-rendering for nothing. */
export function sameOutline(a: Heading[], b: Heading[]): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (
      a[i].line !== b[i].line ||
      a[i].title !== b[i].title ||
      a[i].kind !== b[i].kind ||
      a[i].path !== b[i].path ||
      a[i].end !== b[i].end
    ) {
      return false;
    }
  }
  return true;
}
