/** What that equation looks like, without leaving the source.
 *
 *  Hovering inside maths renders it where the pointer is.  KaTeX is loaded
 *  the first time somebody hovers rather than in the bundle, because a
 *  writer who never touches an equation should not pay 300 KB for it.
 *
 *  The project's own \newcommand definitions are passed through, so
 *  \npistar renders as the notation it stands for rather than as an error.
 */

import { shellTheme } from "../ui/FloatingCard";
import type { EditorView, Tooltip } from "@codemirror/view";
import { hoverCard } from "./hover-card";
import type { Extension } from "@codemirror/state";
import type { Symbols } from "../api";
import { sizeOf } from "../size";
import {
  citationFor, envWord, imageTarget, inputTarget, labelSays, labelTarget, linkAt, refPreview,
} from "./latex-links";
import { shortcut } from "../keys";
import { hoverCards, type HoverKind } from "../appearance";
import type { Cell, Table } from "./table-hover";
import type { LinkKind } from "./latex-links";

/** Which chip on the settings sheet each link kind answers to.  The
 *  writer's names for them are Cross-references, Citations, Figures and
 *  Files; the code's are the link scanner's. */
const CARD_FOR: Record<LinkKind, HoverKind> = { ref: "refs", cite: "cites", image: "figures", input: "files" };

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

const TABLES = ["tabular", "tabular*", "tabularx", "longtable"];

/** The table environment the cursor is inside, if it is inside one: the
 *  whole environment, `\begin` to `\end`.  Scanned over the window the
 *  hover already slices rather than the paragraph, since a long table
 *  can hold a blank line, and asked only after `mathAt` has said no, so
 *  maths inside a cell still wins. */
export function tableAt(whole: string, pos: number): Span | null {
  for (const name of TABLES) {
    const open = `\\begin{${name}}`;
    const close = `\\end{${name}}`;
    let index = 0;
    while ((index = whole.indexOf(open, index)) !== -1) {
      const end = whole.indexOf(close, index);
      if (end === -1) break;
      if (pos > index && pos < end + close.length) {
        return { from: index, to: end + close.length, body: whole.slice(index, end + close.length), display: true };
      }
      index = end + close.length;
    }
  }
  return null;
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

/** What the editor does when a tooltip's verb is pressed: list the
 *  references to a label, a key or a macro, or open the rename. */
export type OnSymbol = (kind: "label" | "cite" | "macro", name: string, rename: boolean) => void;

/** What the hover on `\includegraphics` needs to draw the figure: the
 *  project the file is in, a stamp that changes when the file does (its
 *  modification time, so a regenerated plot is redrawn), and its size on
 *  disk when the tree knows it. */
export type FigureFacts = { projectId: string; stamp: number; size?: number };

/** The formula card's two verbs: the equation typeset by the project's
 *  own TeX with the document's preamble, and handed back as an SVG on
 *  the clipboard or a PNG saved.  Resolves to the sentence the card says
 *  after, and rejects with the one it says instead. */
export type OnEquation = (body: string, format: "svg" | "png") => Promise<string>;

export function mathHover(
  symbols: () => Symbols | null,
  /** The facts for a figure the hover on `\includegraphics` shows, or
   *  null for a file the tree does not hold.  Absent in the read-only
   *  panes, which show the name alone. */
  figure?: (path: string) => FigureFacts | null,
  /** Absent in the read-only panes, which offer no rename. */
  onSymbol?: OnSymbol,
  /** Absent in the read-only panes too: a version being read is not the
   *  document a preamble is taken from. */
  onEquation?: OnEquation,
): Extension {
  return hoverCard((view, pos): Tooltip | null => {
    // Which cards the writer has left on, read off the root now rather
    // than held in a compartment: this source runs on every hover, the
    // language compartment it sits in is never reconfigured (a file
    // change makes a fresh state), and a setting read here takes effect
    // on the next hover with nothing to dispatch.  Nothing on means the
    // hover finds nothing; the editor's other answers to a pointer, the
    // Ctrl-click that follows a link among them, are not this extension's.
    const on = hoverCards();
    if (on.size === 0) return null;
    const doc = view.state.doc;
    const from = Math.max(0, pos - HOVER_WINDOW);
    const to = Math.min(doc.length, pos + HOVER_WINDOW);
    const window_ = doc.sliceString(from, to);
    const near = mathAt(window_, pos - from);
    const span = near && { ...near, from: near.from + from, to: near.to + from };
    // With the formula card off the cascade goes on to the table and the
    // links rather than stopping, so a \label inside an equation still
    // brings its cross-reference card.
    if (!span || !span.body.trim() || !on.has("maths")) {
      const table = tableAt(window_, pos - from);
      if (table && on.has("tables")) return tableTooltip(table.from + from, table.to + from, table.body, symbols);
      return linkTooltip(view, pos, symbols, on, figure, onSymbol);
    }

    return {
      pos: span.from,
      end: span.to,
      create() {
        // The kit's card in the shell's palette, with the maths in a body
        // of its own that has room around it so nothing a sub- or
        // superscript reaches is clipped, and the source beneath it.
        const dom = document.createElement("div");
        dom.className = `nx-math-tooltip nx-card ${shellTheme()}`;
        const body = document.createElement("div");
        body.className = "nx-math-body nx-math-loading";
        // The source, not a spinner: it is the right size, it is useful
        // while KaTeX loads, and the box does not jump when it lands.
        const source = span.body.trim().slice(0, 200);
        body.textContent = source;
        dom.append(body);
        load()
          .then((renderer) => {
            try {
              body.classList.remove("nx-math-loading");
              // The rendered maths alone: the source is in the editor under
              // the card, and a copy of it under the maths was "redundant",
              // the writer said.  The source stood in only while KaTeX
              // loaded.
              renderer.render(prepare(span.body), body, {
                displayMode: span.display,
                throwOnError: false,
                macros: macrosFrom(symbols()),
                trust: false,
                strict: "ignore",
              });
            } catch {
              body.className = "nx-math-body nx-math-failed";
              body.textContent = "This does not render on its own.";
            }
          })
          .catch(() => {
            body.textContent = "Could not load the maths renderer.";
          });
        // In a chunk of its own, fetched with the first formula card, so
        // the entry bundle does not carry it.
        if (onEquation) {
          void import("./equation-verbs")
            .then(({ equationVerbs }) => equationVerbs(dom, span.body, onEquation))
            .catch(() => undefined);
        }
        return { dom };
      },
    };
  });
}

/** The table under the pointer, drawn as a table in the formula card's
 *  body: the columns aligned as the spec says, the booktabs rules as rules,
 *  a header row where a rule follows the first row, maths in a cell set
 *  through KaTeX, and under it the environment's opening line in the mono
 *  and, when the body holds more than the card draws, how many more. */
function tableTooltip(from: number, to: number, source: string, symbols: () => Symbols | null): Tooltip {
  return {
    pos: from,
    end: to,
    create() {
      // The reader is fetched on the first table hovered, as the thumbnail
      // service is, so the editor's chunk does not carry it; the source's
      // first line stands in the card until it lands, a moment.
      const dom = document.createElement("div");
      dom.className = `nx-math-tooltip nx-table-tooltip nx-card ${shellTheme()}`;
      const body = document.createElement("div");
      body.className = "nx-math-body nx-table-body nx-math-loading";
      body.textContent = source.split("\n")[0].trim().slice(0, 200);
      dom.append(body);
      import("./table-hover")
        .then(({ parseTabular }) => {
          const table = parseTabular(source);
          if (!table) {
            body.className = "nx-math-body nx-math-failed";
            body.textContent = "This table does not read on its own.";
            return;
          }
          body.className = "nx-math-body nx-table-body";
          body.textContent = "";
          drawTable(dom, body, table, symbols);
        })
        .catch(() => {
          body.className = "nx-math-body nx-math-failed";
          body.textContent = "Could not load the table reader.";
        });
      return { dom };
    },
  };
}

function drawTable(dom: HTMLElement, body: HTMLElement, table: Table, symbols: () => Symbols | null) {
  const element = document.createElement("table");
  element.className = "nx-table";
  const headed = table.rows.length > 1 && table.rows[1].rule;
  table.rows.forEach((row, at) => {
    const tr = document.createElement("tr");
    if (row.rule) tr.classList.add("nx-table-rule");
    let column = 0;
    for (const cell of row.cells) {
      const td = document.createElement(headed && at === 0 ? "th" : "td");
      const align = cell.align ?? table.columns[column] ?? "l";
      td.className = `nx-table-${align}`;
      if (cell.span > 1) td.colSpan = cell.span;
      if (cell.bold) td.style.fontWeight = "600";
      if (cell.italic) td.style.fontStyle = "italic";
      fill(td, cell, symbols);
      tr.append(td);
      column += cell.span;
    }
    element.append(tr);
  });
  if (table.bottom) element.classList.add("nx-table-bottom");
  body.append(element);
  // The table alone, as the formula card shows the maths alone: its
  // first line is in the editor under the card.
  if (table.more) {
    const more = document.createElement("div");
    more.className = "nx-table-more";
    more.textContent = `and ${table.more} more ${table.more === 1 ? "row" : "rows"}`;
    dom.append(more);
  }
}

/** A cell's content: its text, with any `$…$` in it set through KaTeX
 *  once that has loaded, the source standing in until then as the
 *  formula card does.  A cell that is maths alone is one such span. */
function fill(td: HTMLElement, cell: Cell, symbols: () => Symbols | null) {
  const text = cell.math ? `$${cell.math}$` : cell.text;
  const parts = text.split(/(\$[^$]+\$)/);
  const pending: [HTMLElement, string][] = [];
  for (const part of parts) {
    if (!part) continue;
    const maths = /^\$([^$]+)\$$/.exec(part);
    if (!maths) {
      td.append(document.createTextNode(part));
      continue;
    }
    const span = document.createElement("span");
    span.textContent = maths[1];
    td.append(span);
    pending.push([span, maths[1]]);
  }
  if (!pending.length) return;
  load()
    .then((renderer) => {
      for (const [span, source] of pending) {
        renderer.render(source, span, {
          displayMode: false,
          throwOnError: false,
          macros: macrosFrom(symbols()),
          trust: false,
          strict: "ignore",
        });
      }
    })
    .catch(() => undefined);
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
  /** The cards the writer has left on. */
  on: Set<HoverKind>,
  figure?: (path: string) => FigureFacts | null,
  onSymbol?: OnSymbol,
): Tooltip | null {
  const line = view.state.doc.lineAt(pos);
  const link = linkAt(line.text, pos - line.from);
  if (!link || !on.has(CARD_FOR[link.kind])) return null;
  const table = symbols();
  let says: string;
  /** A second, quieter line: where the label is, under what it says. */
  let where: string | null = null;
  /** The figure to draw, when the link is an image the project holds. */
  let image: { path: string; facts: FigureFacts } | null = null;
  let follow = true;
  /** A citation card has a structure of its own, drawn below. */
  let citation: ReturnType<typeof citationFor> = null;
  /** The figure, table or equation a reference points at, drawn under
   *  what the reference says. */
  let preview: ReturnType<typeof refPreview> = null;
  if (link.kind === "cite") {
    const entry = citationFor(link.name, table);
    citation = entry;
    says = entry
      ? [entry.author, entry.year, entry.title].filter(Boolean).join(", ")
      : `${link.name} is not in the bibliography.`;
    // A citation is a fact, not a place: there is nothing in this project
    // to open for it, so the gesture line would be a lie.
    follow = false;
  } else if (link.kind === "ref") {
    // What the reference says, "Figure 3, on page 7", from the last
    // build's .aux files, with the file and line beneath it.  Before a
    // build there is only the place.
    const target = labelTarget(link.name, table);
    const number = labelSays(target);
    // The thing the reference points at follows that thing's own chip:
    // a writer who turned the picture card off did so to stop seeing
    // the picture, and it should not come back under a \ref.
    const found = refPreview(target, table);
    const kindOf: Record<NonNullable<typeof found>["kind"], HoverKind> = { figure: "figures", table: "tables", equation: "maths" };
    preview = found && on.has(kindOf[found.kind]) ? found : null;
    // The top line is what the reference says: the number after a build,
    // before one the kind of thing from the environment the label sits
    // in, and for a label in neither the label itself; the place is the
    // line beneath, in the mono, as the page draws the card.
    const word = envWord(target?.env);
    says = number
      ? number
      : target
        ? word || `\\label{${link.name}}`
        : `No \\label{${link.name}} in this project.`;
    if (target) where = `${target.file}:${target.line}`;
    follow = Boolean(target);
  } else if (link.kind === "image") {
    const target = imageTarget(link.name, table);
    says = target ?? `${link.name} is not a figure in this project.`;
    const facts = target && figure ? figure(target) : null;
    image = target && facts ? { path: target, facts } : null;
    follow = false;
  } else {
    const target = inputTarget(link.name, table);
    says = target ?? `${link.name} is not a file in this project.`;
    follow = Boolean(target);
  }
  return {
    pos: line.from + link.from,
    end: line.from + link.to,
    create() {
      const dom = document.createElement("div");
      dom.className = `nx-math-tooltip nx-link-tooltip nx-card ${shellTheme()}`;
      if (image) {
        // The same card the file tree opens beside a figure's row, from
        // the same thumbnail service: the picture in a 3:2 box (a PDF's
        // first page, drawn by the pdf.js the preview already loads), the
        // path in the mono, and one line with its pixel size and its size
        // on disk.  The service is fetched when a figure is first hovered
        // and never before, so the editor's chunk does not carry it.
        dom.classList.add("nx-figure-tooltip");
        const box = document.createElement("div");
        box.className = "nx-thumb";
        dom.append(box);
        const { path, facts } = image;
        const meta = document.createElement("div");
        meta.className = "nx-link-hint";
        meta.textContent = facts.size !== undefined ? sizeOf(facts.size) : "";
        import("./thumbnails")
          .then(({ thumbnail }) => thumbnail(facts.projectId, path, facts.stamp, facts.size))
          .then((made) => {
            if (made.url) {
              const picture = document.createElement("img");
              picture.src = made.url;
              picture.alt = says;
              box.append(picture);
            } else {
              box.remove();
            }
            const facts2 = [
              made.width ? `${made.width} × ${made.height}${made.unit === "pt" ? " pt" : ""}` : "",
              facts.size !== undefined ? sizeOf(facts.size) : "",
            ].filter(Boolean);
            meta.textContent = facts2.join(", ");
          })
          .catch(() => box.remove());
        const name = document.createElement("div");
        name.className = "nx-link-name";
        name.textContent = says;
        dom.append(name, meta);
        return { dom };
      }
      if (citation) {
        // Kind and year at the top with the key in the mono at the right,
        // the title, the authors and the venue, and the DOI in the mono:
        // the record, so the writer knows which paper without opening the
        // .bib file.
        const top = document.createElement("div");
        top.className = "nx-cite-top";
        const kind = document.createElement("span");
        kind.textContent = [citation.type ? citation.type[0].toUpperCase() + citation.type.slice(1) : "", citation.year]
          .filter(Boolean).join(", ");
        const key = document.createElement("code");
        key.className = "nx-cite-key";
        key.textContent = citation.key;
        top.append(kind, key);
        dom.append(top);
        if (citation.title) {
          const title = document.createElement("div");
          title.className = "nx-cite-title";
          title.textContent = citation.title;
          dom.append(title);
        }
        const who = [citation.authors || citation.author, citation.venue].filter(Boolean).join(". ");
        if (who) {
          const line = document.createElement("div");
          line.className = "nx-cite-who";
          line.textContent = who + (who.endsWith(".") ? "" : ".");
          dom.append(line);
        }
        if (citation.doi) {
          const doi = document.createElement("code");
          doi.className = "nx-cite-doi";
          doi.textContent = citation.doi;
          dom.append(doi);
        }
      } else {
        const what = document.createElement("div");
        what.textContent = says;
        dom.append(what);
      }
      if (preview) drawPreview(dom, preview, symbols, figure);
      if (where) {
        const place = document.createElement("div");
        place.className = "nx-link-hint nx-link-place";
        place.textContent = where;
        dom.append(place);
      }
      if (follow) {
        const how = document.createElement("div");
        how.className = "nx-link-hint";
        how.textContent = `${shortcut("Mod-click").both} to go there`;
        dom.append(how);
      }
      // The two verbs a name has: where else it is used, and a new name
      // everywhere.  On a label or a citation key, never on a file or a
      // figure, and only where the pane can edit.
      const kind = link.kind === "ref" ? "label" : link.kind === "cite" ? "cite" : null;
      if (kind && onSymbol) {
        const verbs = document.createElement("div");
        verbs.className = "nx-link-verbs";
        for (const [label, rename] of [["Find references", false], ["Rename", true]] as const) {
          const button = document.createElement("button");
          button.type = "button";
          button.className = "nx-button";
          button.dataset.variant = "quiet";
          button.dataset.size = "inline";
          button.textContent = label;
          button.dataset.testid = rename ? "link-rename" : "link-references";
          // An ordinary click.  The buttons acted on `mousedown` once,
          // because the editor's own mousedown closed the tooltip before
          // a click could arrive; the card keeps a press on itself from
          // the editor now, and closes itself after the click.
          button.addEventListener("click", () => onSymbol(kind, link.name, rename));
          verbs.append(button);
        }
        dom.append(verbs);
      }
      return { dom };
    },
  };
}

/** The thing a reference points at, under the line saying its number.
 *
 *  A figure draws its first graphic through the thumbnail service the
 *  tree's card and the `\\includegraphics` hover use, in the same 3:2 box;
 *  a table parses its tabular with the table card's reader and draws it
 *  the same way; an equation is typeset through KaTeX in display mode,
 *  wrapped back in its environment where KaTeX knows it and in `aligned`
 *  where it does not.  The caption follows in the second ink, read
 *  through `plainText` so `\\emph` and `\\SI` do not leak.  Everything
 *  loads on the first hover and never before, as the cards it borrows
 *  from do. */
function drawPreview(
  dom: HTMLElement,
  preview: NonNullable<ReturnType<typeof refPreview>>,
  symbols: () => Symbols | null,
  figure?: (path: string) => FigureFacts | null,
) {
  dom.classList.add("nx-ref-tooltip");
  const caption = "caption" in preview ? preview.caption : "";
  const captionLine = document.createElement("div");
  captionLine.className = "nx-ref-caption";
  if (preview.kind === "figure") {
    const facts = figure ? figure(preview.path) : null;
    const box = document.createElement("div");
    box.className = "nx-thumb";
    dom.append(box);
    if (facts) {
      import("./thumbnails")
        .then(({ thumbnail }) => thumbnail(facts.projectId, preview.path, facts.stamp, facts.size))
        .then((made) => {
          if (!made.url) {
            box.remove();
            return;
          }
          const picture = document.createElement("img");
          picture.src = made.url;
          picture.alt = caption || preview.path;
          box.append(picture);
        })
        .catch(() => box.remove());
    } else {
      box.remove();
    }
  } else if (preview.kind === "table") {
    // A holder of its own, so "and N more rows" lands under the table
    // rather than at the card's end, after the verbs.
    const holder = document.createElement("div");
    const body = document.createElement("div");
    body.className = "nx-math-body nx-table-body nx-math-loading";
    body.textContent = preview.body.split("\n")[0].trim().slice(0, 200);
    holder.append(body);
    dom.append(holder);
    import("./table-hover")
      .then(({ parseTabular }) => {
        const table = parseTabular(preview.body);
        body.textContent = "";
        if (!table) {
          body.className = "nx-math-body nx-math-failed";
          body.textContent = "This table does not read on its own.";
          return;
        }
        body.className = "nx-math-body nx-table-body";
        drawTable(holder, body, table, symbols);
      })
      .catch(() => {
        body.className = "nx-math-body nx-math-failed";
        body.textContent = "Could not load the table reader.";
      });
  } else {
    const body = document.createElement("div");
    body.className = "nx-math-body nx-math-loading";
    body.textContent = preview.body.split("\n")[0].trim().slice(0, 200);
    dom.append(body);
    const known = /^(equation|align|alignat|gather)\*?$/.test(preview.env);
    const wrapped = known
      ? `\\begin{${preview.env}}${preview.body}\\end{${preview.env}}`
      : `\\begin{aligned}${preview.body}\\end{aligned}`;
    load()
      .then((renderer) => {
        body.classList.remove("nx-math-loading");
        renderer.render(prepare(wrapped), body, {
          displayMode: true,
          throwOnError: false,
          macros: macrosFrom(symbols()),
          trust: false,
          strict: "ignore",
        });
      })
      .catch(() => {
        body.className = "nx-math-body nx-math-failed";
        body.textContent = "Could not load the maths renderer.";
      });
  }
  if (caption) {
    captionLine.textContent = caption;
    import("./table-hover")
      .then(({ plainText }) => {
        captionLine.textContent = plainText(caption.replace(/\\label\s*\{[^}]*\}/g, ""));
      })
      .catch(() => undefined);
    dom.append(captionLine);
  }
}

/** Which modifier this keyboard calls the one CodeMirror already reads for
 *  a second cursor. */
export function mac(): boolean {
  return typeof navigator !== "undefined" && /Mac/.test(navigator.platform);
}
