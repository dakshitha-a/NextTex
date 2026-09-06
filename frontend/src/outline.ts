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

/** Turn a raw LaTeX title into something readable in a 240px rail. */
export function clean(raw: string): string {
  let text = raw.replace(DROPPED, " ");
  text = text.replace(/\\\\/g, " ");
  text = text.replace(/\\([&%$#_{}])/g, (_m, c: string) => ESCAPES[c] ?? c);
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
  // molecule -- so keep its name rather than leaving a hole.
  text = text.replace(/\\([a-zA-Z]+)/g, "$1");
  text = text.replace(/[{}$~]/g, " ");
  // The dashes as the reader will see them typeset.  `Born--Oppenheimer` is
  // one name in the source and should read as one name in the rail.
  text = text.replace(/---/g, "\u2014").replace(/--/g, "\u2013");
  text = text.replace(/``|''/g, '"');
  return text.replace(/\s+/g, " ").trim();
}

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

export function outline(text: string): Heading[] {
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
      const path = texPath(arg.body);
      if (path) {
        const label = path.replace(/^.*\//, "").replace(/\.tex$/, "");
        if (!started) preamble.push(found.length);
        found.push({ kind: "file", level: FILE_LEVEL, title: label, line, path });
      }
      for (let j = i; j <= arg.end; j++) if (text[j] === "\n") line++;
      i = arg.end;
      continue;
    }

    const level = LEVELS[name];
    if (level === undefined) { i = after - 1; continue; }

    // `\section*` is unnumbered but still a place in the document.
    let cursor = after;
    while (cursor < text.length && /\s/.test(text[cursor])) cursor++;
    if (text[cursor] === "*") cursor++;
    const open = argumentAt(text, cursor);
    const arg = open === null ? null : braced(text, open);
    if (!arg) { i = after - 1; continue; }

    const title = clean(arg.body);
    found.push({ kind: name as HeadingKind, level, title: title || "(untitled)", line });
    for (let j = i; j <= arg.end; j++) if (text[j] === "\n") line++;
    i = arg.end;
  }

  // Only once the document is known to begin: otherwise every included
  // file in a chapter would be dropped.
  if (started && preamble.length) {
    const drop = new Set(preamble);
    return found.filter((_, index) => !drop.has(index));
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
      a[i].path !== b[i].path
    ) {
      return false;
    }
  }
  return true;
}
