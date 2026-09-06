/** What that equation looks like, without leaving the source.
 *
 *  Hovering inside maths renders it where the pointer is.  KaTeX is loaded
 *  the first time somebody hovers rather than in the bundle, because a
 *  writer who never touches an equation should not pay 300 KB for it.
 *
 *  The project's own \newcommand definitions are passed through, so
 *  \npistar renders as the notation it stands for rather than as an error.
 */

import { hoverTooltip, type Tooltip } from "@codemirror/view";
import type { Extension } from "@codemirror/state";
import type { Symbols } from "../api";

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
export function mathAt(text: string, pos: number): Span | null {
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
    const hit = spans.find((span) => pos > span.from && pos < span.to);
    if (hit) return hit;
  }
  return null;
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

/** \newcommand definitions, in the form KaTeX wants them. */
export function macrosFrom(symbols: Symbols | null): Record<string, string> {
  const macros: Record<string, string> = {};
  for (const command of symbols?.commands ?? []) {
    if (command.definition) macros[`\\${command.name}`] = command.definition;
  }
  return macros;
}

export function mathHover(symbols: () => Symbols | null): Extension {
  return hoverTooltip((view, pos): Tooltip | null => {
    const span = mathAt(view.state.doc.toString(), pos);
    if (!span || !span.body.trim()) return null;

    return {
      pos: span.from,
      end: span.to,
      above: true,
      create() {
        const dom = document.createElement("div");
        dom.className = "nx-math-tooltip";
        dom.textContent = "…";
        load()
          .then((renderer) => {
            try {
              renderer.render(span.body, dom, {
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
