/** What a fold at a line covers: a section down to the next heading of the
 *  same or a higher level, or an environment down to its `\end`.
 *
 *  A chapter is read as its headings by folding the sections, and a
 *  forty-line table is closed while the prose around it is written.  The
 *  ranges are computed from the text rather than from a syntax tree,
 *  because the LaTeX mode is a stream parser with no tree, and the outline
 *  parser already knows what a heading is.  Folding is a view decoration:
 *  the shared document and its undo history are untouched.
 *
 *  Both kinds are found once per document text in `foldRanges`, which the
 *  service memoises per document, since the gutter asks about every visible
 *  line on every redraw.
 */

import { foldEffect, foldService, foldedRanges } from "@codemirror/language";
import type { EditorState, Extension } from "@codemirror/state";
import type { Text } from "@codemirror/state";
import type { Command } from "@codemirror/view";

/** Depth of each sectioning command, LaTeX's own order.  `\part` folds to
 *  the next part; `\paragraph` to the next anything. */
const LEVELS: Record<string, number> = {
  part: 0,
  chapter: 1,
  section: 2,
  subsection: 3,
  subsubsection: 4,
  paragraph: 5,
  subparagraph: 6,
};

/** Environments whose contents are not LaTeX.  A `\end{itemize}` inside a
 *  verbatim block is text, not a closing. */
const VERBATIM = new Set(["verbatim", "Verbatim", "lstlisting", "minted", "comment"]);

/** A line's fold, as offsets into the document. */
export type Fold = { from: number; to: number };

type Open = { name: string; line: number; lineEnd: number };

/** Every foldable range in the text, keyed by the 1-based line the fold
 *  starts on.  A heading's range runs from the end of its own line to the
 *  end of the line before the next heading of its level or above, the
 *  `\end{document}`, or the end of the text, trailing blank lines left
 *  out so the fold ends where the prose does; an environment's runs from
 *  the end of its `\begin` line to the end of the line before its `\end`,
 *  the `\end` line staying visible so the fold reads as a closed box.  A
 *  `\begin` and `\end` on one line fold nothing. */
export function foldRanges(doc: Text): Map<number, Fold> {
  const out = new Map<number, Fold>();
  const headings: { level: number; line: number; lineEnd: number }[] = [];
  const stack: Open[] = [];
  let verbatim: string | null = null;
  let endDocument: number | null = null;

  for (let n = 1; n <= doc.lines; n++) {
    const line = doc.line(n);
    const text = stripComment(line.text);
    if (verbatim) {
      if (text.includes(`\\end{${verbatim}}`)) {
        close(verbatim, n, line, stack, out);
        verbatim = null;
      }
      continue;
    }
    // Environments first, since a heading line rarely opens one and a
    // line can close one environment and open another.
    const opens: string[] = [];
    const closes: string[] = [];
    const call = /\\(begin|end)\s*\{([^}]*)\}/g;
    for (let m = call.exec(text); m; m = call.exec(text)) {
      (m[1] === "begin" ? opens : closes).push(m[2].trim());
    }
    for (const name of closes) close(name, n, line, stack, out);
    for (const name of opens) {
      if (name === "document") continue;
      stack.push({ name, line: n, lineEnd: line.to });
      if (VERBATIM.has(name)) {
        verbatim = name;
        break;
      }
    }
    if (closes.includes("document")) endDocument = n;

    const heading = /\\(part|chapter|section|subsection|subsubsection|paragraph|subparagraph)\*?\s*(?:\[[^\]]*\])?\s*\{/.exec(text);
    if (heading && heading.index === text.search(/\S/)) {
      headings.push({ level: LEVELS[heading[1]], line: n, lineEnd: line.to });
    }
  }

  // A heading folds to the line before the next heading of its level or
  // above, or to the end of the document body.
  const last = endDocument ?? doc.lines + 1;
  for (let i = 0; i < headings.length; i++) {
    const here = headings[i];
    let until = last;
    for (let j = i + 1; j < headings.length; j++) {
      if (headings[j].level <= here.level) {
        until = headings[j].line;
        break;
      }
    }
    // The line before the next heading, minus trailing blank lines.
    let endLine = until - 1;
    while (endLine > here.line && !doc.line(endLine).text.trim()) endLine -= 1;
    if (endLine <= here.line) continue;
    const range = { from: here.lineEnd, to: doc.line(endLine).to };
    // An environment that opens on the heading's own line is not a thing
    // that happens; the heading's fold wins where both would start there.
    out.set(here.line, range);
  }
  return out;
}

/** An `\end{name}` on line `n`: the innermost open environment of that
 *  name folds down to the line before.  An unmatched `\end` is ignored,
 *  and an `\end` of an outer name closes the inner ones too, which is
 *  what LaTeX itself does, with a complaint. */
function close(
  name: string, n: number, line: { from: number; to: number },
  stack: Open[], out: Map<number, Fold>,
) {
  for (let i = stack.length - 1; i >= 0; i--) {
    if (stack[i].name !== name) continue;
    const open = stack[i];
    stack.length = i;
    // The `\end` line stays visible, so the fold reads as a closed box; a
    // begin on line 3 and an end on line 4 have nothing between them.
    if (n - 1 > open.line && !out.has(open.line)) {
      out.set(open.line, { from: open.lineEnd, to: line.from - 1 });
    }
    return;
  }
}

/** A line's text with its comment removed, `\%` kept. */
function stripComment(text: string): string {
  let out = "";
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === "\\") {
      out += c + (text[i + 1] ?? "");
      i += 1;
      continue;
    }
    if (c === "%") break;
    out += c;
  }
  return out;
}

/** The fold that starts on the line holding `lineStart`, or null. */
export function foldAt(state: EditorState, lineStart: number, cache: Map<number, Fold>): Fold | null {
  const n = state.doc.lineAt(lineStart).number;
  return cache.get(n) ?? null;
}

/** The CodeMirror service: one range computation per document version,
 *  answered per line from the map. */
export function latexFolding(): Extension {
  let forDoc: Text | null = null;
  let ranges = new Map<number, Fold>();
  return foldService.of((state, lineStart) => {
    if (state.doc !== forDoc) {
      ranges = foldRanges(state.doc);
      forDoc = state.doc;
    }
    return foldAt(state, lineStart, ranges);
  });
}

/** Fold the section or environment the caret is in: the innermost range
 *  that starts at or above the caret's line and reaches it.  The
 *  library's `foldCode` folds only a range starting on the caret's own
 *  line, which is never where a writer is when they want a section out
 *  of the way. */
export const foldEnclosing: Command = (view) => {
  const { state } = view;
  const ranges = foldRanges(state.doc);
  const head = state.selection.main.head;
  const line = state.doc.lineAt(head).number;
  let best: Fold | null = null;
  for (let n = line; n >= 1; n--) {
    const fold = ranges.get(n);
    if (!fold) continue;
    // Starting on the caret's line counts; otherwise the fold must reach
    // the caret.  The first hit walking upward is the innermost.
    if (n === line || fold.to >= head) {
      best = fold;
      break;
    }
  }
  if (!best) return false;
  const chosen = best;
  let already = false;
  foldedRanges(state).between(chosen.from, chosen.to, (from, to) => {
    if (from === chosen.from && to === chosen.to) already = true;
  });
  if (already) return false;
  view.dispatch({ effects: foldEffect.of(chosen) });
  return true;
};
