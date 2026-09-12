/** What that equation looks like, without leaving the source.
 *
 *  Hovering inside maths renders it where the pointer is.  KaTeX is loaded
 *  the first time somebody hovers rather than in the bundle, because a
 *  writer who never touches an equation should not pay 300 KB for it.
 *
 *  The project's own \newcommand definitions are passed through, so
 *  \npistar renders as the notation it stands for rather than as an error.
 */

import { hoverTooltip, type EditorView, type Tooltip } from "@codemirror/view";
import type { Extension } from "@codemirror/state";
import type { Symbols } from "../api";
import { citationFor, inputTarget, labelTarget, linkAt } from "./latex-links";

type Katex = typeof import("katex");
let katex: Katex | null = null;
let loading: Promise<Katex> | null = null;

async function load(): Promise<Katex> {
  if (katex) return katex;
  if (!loading) {
    loading = Promise.all([
      import("katex"),
      import("katex/dist/katex.min.css"),
    ]).then(([module]) => {
      katex = (module as any).default ?? module;
      return katex as Katex;
    }).catch((failure) => {
      // The rejected promise was kept, so one failed fetch, on a flaky
      // connection or during a deploy, meant every equation for the rest
      // of the session hovered as nothing with no way to try again short
      // of reloading. `spellcheck.ts` clears its own the same way.
      loading = null;
      throw failure;
    });
  }
  return loading;
}

type Span = { from: number; to: number; body: string; display: boolean };

const ENVIRONMENTS = [
  "equation", "equation*", "align", "align*", "gather", "gather*",
  "multline", "multline*", "eqnarray", "eqnarray*", "split", "cases",
];

/** The maths the cursor is inside, if it is inside any. */
export function mathAt(whole: string, pos: number): Span | null {
  // Scan the paragraph the pointer is in, not the file.  An unclosed $ --
  // the commonest LaTeX typo there is -- would otherwise invert the
  // pairing for everything after it, so hovering prose would render maths
  // and hovering maths would render nothing.  It also keeps this cheap
  // enough to run on every pointer move.
  const start = paragraphStart(whole, pos);
  const end = paragraphEnd(whole, pos);
  const span = scan(whole.slice(start, end), pos - start);
  if (!span) return null;
  return { ...span, from: span.from + start, to: span.to + start };
}

const BLOCK_BREAK = /\n[ \t]*\n/g;

function paragraphStart(text: string, pos: number): number {
  let found = 0;
  BLOCK_BREAK.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = BLOCK_BREAK.exec(text)) !== null) {
    if (match.index >= pos) break;
    found = match.index + match[0].length;
  }
  return found;
}

function paragraphEnd(text: string, pos: number): number {
  BLOCK_BREAK.lastIndex = pos;
  const match = BLOCK_BREAK.exec(text);
  return match ? match.index : text.length;
}

function scan(text: string, pos: number): Span | null {
  // \begin{equation} ... \end{equation}
  for (const name of ENVIRONMENTS) {
    const open = `\\begin{${name}}`;
    const close = `\\end{${name}}`;
    let index = 0;
    while ((index = text.indexOf(open, index)) !== -1) {
      const end = text.indexOf(close, index);
      if (end === -1) break;
      if (pos > index && pos < end + close.length) {
        return {
          from: index,
          to: end + close.length,
          body: text.slice(index, end + close.length),
          display: true,
        };
      }
      index = end + close.length;
    }
  }

  for (const [open, close] of [["\\[", "\\]"], ["\\(", "\\)"]] as const) {
    let index = 0;
    while ((index = text.indexOf(open, index)) !== -1) {
      const end = text.indexOf(close, index + 2);
      if (end === -1) break;
      if (pos > index && pos < end + 2) {
        return {
          from: index, to: end + 2,
          body: text.slice(index + 2, end),
          display: open === "\\[",
        };
      }
      index = end + 2;
    }
  }

  // $$ ... $$ then $ ... $, in that order: the first would otherwise be
  // read as two empty inline spans.
  for (const marker of ["$$", "$"]) {
    const spans = delimited(text, marker);
    // An odd number of delimiters in this block means somebody is still
    // typing; guessing which pair they meant is worse than saying nothing.
    if (spans.length && countUnescaped(text, marker) % 2) continue;
    const hit = spans.find((span) => pos > span.from && pos < span.to);
    if (hit) return hit;
  }
  return null;
}

function countUnescaped(text: string, marker: string): number {
  let count = 0;
  for (let index = 0; index < text.length; index += 1) {
    if (text[index] === "\\") {
      index += 1;
      continue;
    }
    if (text.startsWith(marker, index)) {
      if (marker === "$" && text.startsWith("$$", index)) {
        index += 1;
        continue;
      }
      count += 1;
      index += marker.length - 1;
    }
  }
  return count;
}

function delimited(text: string, marker: string): Span[] {
  const spans: Span[] = [];
  let index = 0;
  let open = -1;
  while (index < text.length) {
    if (text[index] === "\\") {
      index += 2;         // an escaped dollar is a price, not a delimiter
      continue;
    }
    if (text.startsWith(marker, index)) {
      if (marker === "$" && text.startsWith("$$", index)) {
        index += 2;
        continue;
      }
      if (open === -1) {
        open = index;
      } else {
        spans.push({
          from: open,
          to: index + marker.length,
          body: text.slice(open + marker.length, index),
          display: marker === "$$",
        });
        open = -1;
      }
      index += marker.length;
      continue;
    }
    index += 1;
  }
  return spans;
}

/** What KaTeX can render, out of what LaTeX accepts.
 *
 *  A numbered equation nearly always carries a \label, and KaTeX refuses
 *  the whole expression when it meets one -- so the parts that exist for
 *  the document rather than for the mathematics are removed first, and an
 *  `equation` wrapper is unwrapped because KaTeX displays it either way.
 */
export function prepare(body: string): string {
  let text = body
    .replace(/\\label\s*\{[^}]*\}/g, "")
    .replace(/\\(?:nonumber|notag)\b/g, "")
    .replace(/\\intertext\s*\{[^}]*\}/g, "")
    .replace(/%.*$/gm, "");
  const wrapper = /^\s*\\begin\{(equation\*?|displaymath)\}([\s\S]*)\\end\{\1\}\s*$/.exec(text);
  if (wrapper) text = wrapper[2];
  return text.trim();
}

/** \newcommand definitions, in the form KaTeX wants them. */
export function macrosFrom(symbols: Symbols | null): Record<string, string> {
  const macros: Record<string, string> = {
    // Not a KaTeX command, and it appears in half the macros a chemist
    // writes: \newcommand{\npistar}{\ensuremath{n\pi^{*}}}.
    "\\ensuremath": "#1",
    "\\text": "\\textrm{#1}",
  };
  for (const command of symbols?.commands ?? []) {
    if (command.definition) macros[`\\${command.name}`] = command.definition;
  }
  return macros;
}

/** How much of the document either side of the pointer is looked at.
 *
 *  `mathAt` narrows to a paragraph anyway, and no paragraph in a thesis is
 *  anywhere near this long.  What this avoids is materialising the whole
 *  document as one string on every hover -- two megabytes of chapter, for a
 *  span of at most a few hundred characters. */
const HOVER_WINDOW = 20_000;

export function mathHover(symbols: () => Symbols | null): Extension {
  return hoverTooltip((view, pos): Tooltip | null => {
    const doc = view.state.doc;
    const from = Math.max(0, pos - HOVER_WINDOW);
    const to = Math.min(doc.length, pos + HOVER_WINDOW);
    const near = mathAt(doc.sliceString(from, to), pos - from);
    const span = near && { ...near, from: near.from + from, to: near.to + from };
    if (!span || !span.body.trim()) return linkTooltip(view, pos, symbols);

    return {
      pos: span.from,
      end: span.to,
      above: true,
      create() {
        const dom = document.createElement("div");
        dom.className = "nx-math-tooltip";
        // The source, not a spinner: it is the right size, it is useful
        // while KaTeX loads, and the box does not jump when it lands.
        dom.textContent = span.body.trim().slice(0, 200);
        dom.classList.add("nx-math-loading");
        load()
          .then((renderer) => {
            try {
              dom.classList.remove("nx-math-loading");
              renderer.render(prepare(span.body), dom, {
                displayMode: span.display,
                throwOnError: false,
                macros: macrosFrom(symbols()),
                trust: false,
                strict: "ignore",
              });
            } catch {
              dom.className = "nx-math-tooltip nx-math-failed";
              dom.textContent = "This does not render on its own.";
            }
          })
          .catch(() => {
            dom.textContent = "Could not load the maths renderer.";
          });
        return { dom };
      },
    };
  }, { hoverTime: 250 });
}

/** What a cross reference points at, and how to follow it.
 *
 *  In the same tooltip as the maths and after it, because the two never
 *  overlap: a `\ref` is not inside an equation. It carries the Ctrl-click
 *  line as well as the answer, since a modifier-click is not a gesture
 *  anybody finds by looking at the screen, and the hover is the only place
 *  it can be mentioned at the moment it would be used.
 */
function linkTooltip(
  view: EditorView, pos: number, symbols: () => Symbols | null,
): Tooltip | null {
  const line = view.state.doc.lineAt(pos);
  const link = linkAt(line.text, pos - line.from);
  if (!link) return null;
  const table = symbols();
  let says: string;
  let follow = true;
  if (link.kind === "cite") {
    const entry = citationFor(link.name, table);
    says = entry
      ? [entry.author, entry.year, entry.title].filter(Boolean).join(", ")
      : `${link.name} is not in the bibliography.`;
    // A citation is a fact, not a place: there is nothing in this project
    // to open for it, so the gesture line would be a lie.
    follow = false;
  } else if (link.kind === "ref") {
    const target = labelTarget(link.name, table);
    says = target
      ? `${target.file}, line ${target.line}`
      : `No \\label{${link.name}} in this project.`;
    follow = Boolean(target);
  } else {
    const target = inputTarget(link.name, table);
    says = target ?? `${link.name} is not a file in this project.`;
    follow = Boolean(target);
  }
  return {
    pos: line.from + link.from,
    end: line.from + link.to,
    above: true,
    create() {
      const dom = document.createElement("div");
      dom.className = "nx-math-tooltip nx-link-tooltip";
      const what = document.createElement("div");
      what.textContent = says;
      dom.append(what);
      if (follow) {
        const how = document.createElement("div");
        how.className = "nx-link-hint";
        how.textContent = mac() ? "Cmd-click to go there" : "Ctrl-click to go there";
        dom.append(how);
      }
      return { dom };
    },
  };
}

/** Which modifier this keyboard calls the one CodeMirror already reads for
 *  a second cursor. */
export function mac(): boolean {
  return typeof navigator !== "undefined" && /Mac/.test(navigator.platform);
}
