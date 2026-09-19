// CodeMirror wiring kept apart from React.  The view is created once and
// swapped between documents with `setState`, which is what makes tab
// switching land in the same frame and keeps per-file undo history intact.

import {
  Compartment,
  EditorState,
  RangeSetBuilder,
  StateEffect,
  StateField,
  type Extension,
} from "@codemirror/state";
import {
  Decoration,
  type DecorationSet,
  EditorView,
  ViewPlugin,
  type ViewUpdate,
  crosshairCursor,
  drawSelection,
  highlightActiveLine,
  highlightActiveLineGutter,
  highlightSpecialChars,
  keymap,
  lineNumbers,
  rectangularSelection,
} from "@codemirror/view";
import {
  addCursorAbove,
  addCursorBelow,
  defaultKeymap,
  history,
  historyKeymap,
  indentWithTab,
} from "@codemirror/commands";
import { acceptCompletion } from "@codemirror/autocomplete";
import { search, searchKeymap, highlightSelectionMatches } from "@codemirror/search";
import {
  HighlightStyle,
  bracketMatching,
  codeFolding,
  foldGutter,
  foldKeymap,
  indentUnit,
  StreamLanguage,
  syntaxHighlighting,
} from "@codemirror/language";
import { foldEnclosing, latexFolding } from "../folds";
import { tags } from "@lezer/highlight";
import { stex } from "@codemirror/legacy-modes/mode/stex";
import { python } from "@codemirror/legacy-modes/mode/python";
import { closeBrackets, closeBracketsKeymap } from "@codemirror/autocomplete";
import type { Diagnostic, Symbols } from "../api";
import { latexCompletions } from "./latex-complete";
import { bibCompletions } from "./bib-complete";
import { environmentToClose, indentOf, opensEnvironment } from "./close-environment";
import { isEscaped } from "./escaping";
import { isBib, isScript } from "./file-kinds";
import { inputTarget, labelTarget, linkAt } from "./latex-links";
import { mac } from "./math-hover";
import { mathHover, type OnSymbol } from "./math-hover";
import {
  braceAfter,
  commentStart,
  familyOf,
  familyOfEnvironment,
  inlineMath,
  TITLED,
} from "./latex-families";

/** One language instance, because the closing-bracket set is attached to
 *  it: a second `StreamLanguage.define(stex)` would be a different
 *  language and would not carry it.  Defined ahead of the highlight styles
 *  because each style is scoped to its language. */
const LATEX = StreamLanguage.define(stex);

/** The figure scripts the agent writes, and any other `.py` in the
 *  project.  The legacy mode names `self` as a token type of its own, and
 *  that is not a tag `@lezer/highlight` knows, so without the table here
 *  the console warned "Unknown highlighting tag self" once per page and
 *  the word took no style at all. */
const PYTHON = StreamLanguage.define({
  ...python,
  tokenTable: { self: tags.special(tags.variableName) },
});

/** Near-monochrome by default.  The rendered page is two panes away, and a
 *  rainbow of token colours beside it makes the source look like the louder
 *  object, so weight and italics carry the structure here and the reserved
 *  accents stay out of the text entirely.
 *
 *  Colouring control sequences by family is offered as a setting on top of
 *  this rather than instead of it -- see `commandFamilies` below and the
 *  `--syn-*` tokens in styles.css.  These tags cover what is left: the
 *  comments, the braces and the literals, which have no family.
 *
 *  The weights are the editor's own `--nx-weight-strong` rather than a flat
 *  600, because the prose is a setting now and a light page sets it a step
 *  heavier again.  A command has to stay a step above whatever the prose
 *  around it is, and in this mode weight is the only thing saying so.
 *
 *  The keyword colour is a variable with the ink as its fallback, so that
 *  the pane can hand a command a colour when the writer has turned the
 *  weight off: see `.nx-syntax-plain` in styles.css. */
const latexHighlight = HighlightStyle.define([
  { tag: tags.comment, color: "var(--ink-3)", fontStyle: "italic" },
  { tag: tags.keyword, color: "var(--nx-syn-keyword, var(--ink))", fontWeight: "var(--nx-weight-strong, 600)" },
  { tag: tags.tagName, color: "var(--nx-syn-keyword, var(--ink))", fontWeight: "var(--nx-weight-strong, 600)" },
  { tag: tags.atom, color: "var(--ink-2)" },
  { tag: tags.string, color: "var(--ink-2)" },
  { tag: tags.bracket, color: "var(--ink-3)" },
  { tag: tags.number, color: "var(--ink-2)" },
  { tag: tags.variableName, color: "var(--ink-2)" },
  { tag: tags.typeName, color: "var(--ink-2)" },
  { tag: tags.emphasis, fontStyle: "italic" },
  { tag: tags.strong, fontWeight: "var(--nx-weight-strong, 600)" },
], { scope: LATEX });

/** The same near-monochrome look for a script, and the same switch.
 *
 *  A script's tokens can be told apart by the mode, which a control
 *  sequence's cannot, so here the colour mode is a HighlightStyle rather
 *  than a decoration pass: every colour is a variable with the ink as its
 *  fallback, and `.nx-syntax-colour .cm-editor` in styles.css fills the
 *  five variables from the five family tokens.  Nothing new is mixed: a
 *  keyword is structure, a defined name is what an environment's name is
 *  to LaTeX, a string is a literal the way a citation key is, a number is
 *  maths, and a builtin or a decorator is something the environment
 *  provides, which is what the preamble does.  The keyword's inner
 *  fallback is the plain-emphasis colour, so a script with the weight
 *  turned off reads its `def` the way a chapter reads its `\textbf`. */
const pythonHighlight = HighlightStyle.define([
  { tag: tags.comment, color: "var(--ink-3)", fontStyle: "italic" },
  {
    tag: tags.keyword,
    color: "var(--nx-py-keyword, var(--nx-syn-keyword, var(--ink)))",
    fontWeight: "var(--nx-weight-strong, 600)",
  },
  {
    tag: tags.definition(tags.variableName),
    color: "var(--nx-py-name, var(--ink))",
    fontWeight: "var(--nx-weight-strong, 600)",
  },
  { tag: tags.standard(tags.variableName), color: "var(--nx-py-builtin, var(--ink-2))" },
  { tag: tags.meta, color: "var(--nx-py-builtin, var(--ink-2))" },
  { tag: tags.string, color: "var(--nx-py-string, var(--ink-2))" },
  { tag: tags.number, color: "var(--nx-py-number, var(--ink-2))" },
  { tag: tags.variableName, color: "var(--ink-2)" },
  { tag: tags.propertyName, color: "var(--ink-2)" },
  { tag: tags.special(tags.variableName), color: "var(--ink-2)" },
  { tag: tags.operator, color: "var(--ink)" },
], { scope: PYTHON });

/** Colour by family, over the lines actually on screen.
 *
 *  A `ViewPlugin` rather than a `HighlightStyle` because the family cannot
 *  be read off the token: `stex` reports `\\section`, `\\cite` and
 *  `\\usepackage` all as the same thing.  Only the visible ranges are
 *  scanned, and only on a change to the document or the viewport, so a
 *  10,000-line chapter costs the same as a short one.
 *
 *  The decorations are added whatever the setting says.  In the subtle mode
 *  every `--syn-*` token resolves to the ordinary ink, so the marks are
 *  there and invisible, and the switch is a change of two CSS variables
 *  rather than a reconfiguration of the editor.
 */
function commandFamilies(view: EditorView): DecorationSet {
  const mark = (family: string) =>
    Decoration.mark({ class: `nx-syn-${family}` });
  // The heading, or the name of an environment.  Marked apart from the
  // command so that the subtle mode can leave it at --ink-2, which is what
  // it has always been.
  const argument = (family: string) =>
    Decoration.mark({ class: `nx-syn-arg-${family}` });
  // Collected rather than added as they are found: a `$...$` span starts
  // before the commands inside it, and `RangeSetBuilder` insists on
  // receiving ranges in order.
  const found: { from: number; to: number; deco: Decoration }[] = [];
  const add = (from: number, to: number, deco: Decoration) =>
    found.push({ from, to, deco });
  let lastLine = -1;
  for (const range of view.visibleRanges) {
    let pos = range.from;
    while (pos <= range.to) {
      const line = view.state.doc.lineAt(pos);
      // Two visible ranges can meet inside one line; scanning it twice
      // would add the same range to the builder twice, out of order.
      if (line.number === lastLine) { pos = line.to + 1; continue; }
      lastLine = line.number;

      // A command in a comment is prose about a command, not one.
      const cut = commentStart(line.text);
      const text = cut < 0 ? line.text : line.text.slice(0, cut);

      // Inline mathematics, which has no command to key on.
      for (const span of inlineMath(text)) {
        add(
          line.from + span.from,
          line.from + span.to,
          Decoration.mark({ class: "nx-syn-inline-math" }),
        );
      }

      for (const found of text.matchAll(/\\([a-zA-Z@]+\*?)/g)) {
        const name = found[1];
        const at = found.index ?? 0;
        const after = at + 1 + name.length;
        let family = familyOf(name);
        const bare = name.endsWith("*") ? name.slice(0, -1) : name;

        // `\begin{align}` is an equation and `\begin{table}` is not, so
        // the environment's name decides the family of both.
        const environment =
          bare === "begin" || bare === "end" ? braceAfter(text, after) : null;
        if (environment) {
          family = familyOfEnvironment(
            text.slice(environment.open + 1, environment.close),
          );
        }
        if (!family) continue;

        add(line.from + at, line.from + after, mark(family));
        if (environment) {
          add(
            line.from + environment.open + 1,
            line.from + environment.close,
            argument(family),
          );
        } else if (TITLED.has(bare)) {
          // The heading itself, not only the command that introduces it:
          // the title is the thing you are scanning the file for.
          const title = braceAfter(text, after);
          if (title && title.close > title.open + 1) {
            add(
              line.from + title.open + 1,
              line.from + title.close,
              argument(family),
            );
          }
        }
      }
      pos = line.to + 1;
    }
  }
  // Outermost first where two start together, so a span always encloses
  // what it contains rather than interleaving with it.
  found.sort((a, b) => a.from - b.from || b.to - a.to);
  const builder = new RangeSetBuilder<Decoration>();
  for (const range of found) builder.add(range.from, range.to, range.deco);
  return builder.finish();
}

const familyHighlight = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = commandFamilies(view);
    }
    update(update: ViewUpdate) {
      if (update.docChanged || update.viewportChanged) {
        this.decorations = commandFamilies(update.view);
      }
    }
  },
  { decorations: (plugin) => plugin.decorations },
);

/** Where the spell checker goes when it is switched on. */
export const spellCompartment = new Compartment();
/** Where Vim or Emacs goes when one is chosen; `[]` otherwise, so a
 *  session that wants neither pays nothing.  First in the extensions so
 *  its keys are seen before the app's own. */
export const keymapCompartment = new Compartment();

export type Mark = {
  line: number;
  severity: "error" | "warning";
  /** 1-based, or null when the tool that found this had no column to give.
   *  A mark without one draws no underline at all -- see `markField`. */
  column: number | null;
};

/** At most this many underlines on one line.  chktex on a dense preamble
 *  finds dozens; past three the underlines are the mess they were brought
 *  in to replace, and the diagnostics drawer still lists every one. */
const MAX_UNDERLINES_PER_LINE = 3;
/** And at most this many marks in one file, for the same reason. */
const MAX_MARKS = 200;
/** How far an underline may run before it stops pointing at a token and
 *  starts highlighting a passage. */
const MAX_TOKEN = 40;
/** Characters that end the token an underline covers.  A leading backslash
 *  is deliberately not one of them, so `\\citep` underlines as one word. */
const TOKEN_BREAK = new Set([" ", "\t", "{", "}", "$", "%", "\\"]);

/** Where the underline for a mark should start and end, or null when there
 *  is nothing worth pointing at.
 *
 *  Column 1 is treated as no column at all: chktex reports it for a large
 *  share of its findings, which is indistinguishable from having nothing
 *  better to say, and the LaTeX log has no column ever.
 */
export function tokenAt(
  text: string,
  column: number | null,
): { from: number; to: number } | null {
  if (column == null || column < 2) return null;
  const start = column - 1;
  if (start >= text.length) return null;
  let end = start;
  // The first character is taken whatever it is -- a backslash starts a
  // command, and a break character on its own is still the thing chktex is
  // pointing at.
  while (end < text.length && end - start < MAX_TOKEN) {
    if (end > start && TOKEN_BREAK.has(text[end])) break;
    end += 1;
  }
  if (end <= start) return null;
  return { from: start, to: end };
}

export const setMarks = StateEffect.define<Mark[]>();
/** Lines that differ from the live file, while an old version is on screen. */
export const setDiff = StateEffect.define<number[]>();
export const flashRange = StateEffect.define<{ from: number; to: number } | null>();
/** Drop the fading highlight once it has finished fading. */
export const clearFlash = StateEffect.define<null>();

const markField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(marks, tr) {
    for (const effect of tr.effects) {
      if (!effect.is(setMarks)) continue;
      const builder: any[] = [];
      // One gutter bar per line, and the error wins where both land on the
      // same one -- the array used to decide that by accident, whichever
      // came first.
      const bars = new Map<number, "error" | "warn">();
      // Underlines are deduplicated on line *and* column, so two findings
      // on one line each point at their own token.  Collapsing them by line
      // was why the drawer's count and the editor never agreed.
      const drawn = new Set<string>();
      const perLine = new Map<number, number>();
      for (const mark of effect.value) {
        if (mark.line < 1 || mark.line > tr.state.doc.lines) continue;
        if (drawn.size >= MAX_MARKS) break;
        const line = tr.state.doc.line(mark.line);
        const cls = mark.severity === "error" ? "error" : "warn";
        if (bars.get(mark.line) !== "error") bars.set(mark.line, cls);

        // No column means no underline.  A dotted rule under a whole line
        // of LaTeX points at nothing the gutter bar has not already said,
        // and it is drawn through text the writer is trying to read; every
        // compile error takes this branch, because the LaTeX log has no
        // columns.
        const span = tokenAt(line.text, mark.column ?? null);
        if (!span) continue;
        const key = `${mark.line}:${mark.column}:${cls}`;
        if (drawn.has(key)) continue;
        const already = perLine.get(mark.line) ?? 0;
        if (already >= MAX_UNDERLINES_PER_LINE) continue;
        drawn.add(key);
        perLine.set(mark.line, already + 1);
        builder.push(
          Decoration.mark({ class: `cm-mark-${cls}` }).range(
            line.from + span.from,
            line.from + span.to,
          ),
        );
      }
      for (const [line, cls] of bars) {
        builder.push(
          Decoration.line({ class: `cm-gutter-${cls}` }).range(
            tr.state.doc.line(line).from,
          ),
        );
      }
      builder.sort((a, b) => a.from - b.from || a.value.startSide - b.value.startSide);
      return Decoration.set(builder, true);
    }
    return tr.docChanged ? marks.map(tr.changes) : marks;
  },
  provide: (field) => EditorView.decorations.from(field),
});

const diffField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(current, tr) {
    for (const effect of tr.effects) {
      if (!effect.is(setDiff)) continue;
      const marks = effect.value
        .filter((line) => line >= 1 && line <= tr.state.doc.lines)
        .map((line) =>
          Decoration.line({ class: "cm-version-changed" }).range(
            tr.state.doc.line(line).from,
          ),
        );
      return Decoration.set(marks, true);
    }
    return current;
  },
  provide: (field) => EditorView.decorations.from(field),
});

const flashField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(current, tr) {
    for (const effect of tr.effects) {
      if (!effect.is(flashRange)) continue;
      if (!effect.value) {
        // Swap to the fading class rather than dropping the decoration, so
        // the highlight leaves the way the specification asks -- over
        // 450 ms -- instead of snapping off in one frame.
        const existing: any[] = [];
        current.between(0, tr.state.doc.length, (from, to, value) => {
          const spec = (value as any).spec ?? {};
          const fading = spec.class?.includes("cm-line-flash");
          if (!fading) return;
          existing.push(
            (spec.widget || to === from
              ? Decoration.line({ class: "cm-line-fading" })
              : Decoration.mark({ class: "cm-line-fading" })
            ).range(from, to === from ? undefined : to) as any,
          );
        });
        return existing.length ? Decoration.set(existing, true) : Decoration.none;
      }
      const { from, to } = effect.value;
      return Decoration.set([
        Decoration.line({ class: "cm-line-flash" }).range(
          tr.state.doc.lineAt(from).from,
        ),
        ...(to > from
          ? [Decoration.mark({ class: "cm-line-flash" }).range(from, to)]
          : []),
      ]);
    }
    for (const effect of tr.effects) {
      if (effect.is(clearFlash)) return Decoration.none;
    }
    return tr.docChanged ? current.map(tr.changes) : current;
  },
  provide: (field) => EditorView.decorations.from(field),
});

export function marksFor(
  diagnostics: Diagnostic[],
  path: string,
  show: { errors: boolean; warnings: boolean } = { errors: true, warnings: true },
): Mark[] {
  return diagnostics
    .filter((d) => d.file === path && d.line)
    .filter((d) => (d.severity === "error" ? show.errors : show.warnings))
    .map((d) => ({
      line: d.line as number,
      severity: d.severity === "error" ? ("error" as const) : ("warning" as const),
      column: d.column ?? null,
    }));
}

/** Everything both the live editor and a historical view want.
 *
 *  Not undo.  A live editor's undo belongs to the scoped `Y.UndoManager`
 *  that `collab.ts` builds, which tracks only what this keyboard typed;
 *  CodeMirror's own `history()` tracks every transaction, including the
 *  one that carries the whole file in from the socket.  See `withHistory`.
 */
/** Enter at the end of a `\begin{x}` line writes the block.
 *
 *  The caret lands on the empty line between the two, indented to match,
 *  which is where the writer was going to type anyway.
 */
function closeEnvironment(view: EditorView): boolean {
  const { state } = view;
  if (state.selection.ranges.length !== 1 || !state.selection.main.empty) {
    return false;
  }
  const at = state.selection.main.head;
  const line = state.doc.lineAt(at);
  // At the end of the line, not in the middle of it: pressing Enter to
  // split `\begin{figure}` away from something after it is a different
  // gesture and must stay what it was.
  if (at !== line.to) return false;
  // The line before the document, because `state.doc.toString()` is the
  // whole buffer and this runs on every press of Enter, almost all of
  // which are on lines that open nothing.
  if (!opensEnvironment(line.text)) return false;
  const name = environmentToClose(line.text, state.doc.toString());
  if (!name) return false;
  const pad = indentOf(line.text);
  const insert = `\n${pad}  \n${pad}\\end{${name}}`;
  view.dispatch({
    changes: { from: at, insert },
    selection: { anchor: at + 1 + pad.length + 2 },
    scrollIntoView: true,
    userEvent: "input.complete",
  });
  return true;
}

/** Which language a buffer speaks.
 *
 *  A compartment, because the view is one object swapped between files
 *  with `setState`, and every state carries its own language: a chapter
 *  and a script are open at once and each has to keep its own.  The
 *  LaTeX extensions that make no sense over Python live here too, so a
 *  script does not offer `\section` completions on a backslash, follow
 *  `\ref` links, colour command families or float maths on hover. */
export const languageCompartment = new Compartment();

/** Follow a cross reference under the pointer.
 *
 *  The modifier is Ctrl on Linux and Windows and Cmd on a Mac, which is
 *  what every editor with a go-to-definition uses. CodeMirror reads the
 *  same one for a second cursor, and since the editor allows several
 *  selections a modifier-click that is *not* on a link adds one, which is
 *  CodeMirror's meaning for it and is left alone. The handler claims the
 *  event only when there is a link under the pointer, so a `\ref` costs
 *  one place a second cursor cannot be put by mouse, and nothing else.
 */
function followLinks(
  symbols: () => Symbols | null,
  open: (path: string, line?: number) => void,
) {
  return EditorView.domEventHandlers({
    mousedown(event, view) {
      if (event.button !== 0) return false;
      if (!(mac() ? event.metaKey : event.ctrlKey)) return false;
      const at = view.posAtCoords({ x: event.clientX, y: event.clientY });
      if (at === null) return false;
      const line = view.state.doc.lineAt(at);
      const link = linkAt(line.text, at - line.from);
      // A citation names a paper, not a place in this project, so there
      // is nothing to open and the click stays CodeMirror's.
      if (!link || link.kind === "cite") return false;
      const target = link.kind === "ref"
        ? labelTarget(link.name, symbols())
        : inputTarget(link.name, symbols());
      if (!target) {
        // Not a fall-through to multi-cursor: a click that was aimed at a
        // reference and quietly did something else reads as the editor
        // misbehaving. The hover already says the target is missing.
        event.preventDefault();
        return true;
      }
      event.preventDefault();
      if (typeof target === "string") open(target);
      else open(target.file, target.line);
      return true;
    },
  });
}

/** The gutter's marker: a small chevron that turns when the fold is
 *  closed, in the gutter's own ink, rather than the library's triangle. */
function foldMarker(open: boolean): HTMLElement {
  const span = document.createElement("span");
  span.className = "cm-foldMarker";
  span.textContent = open ? "⌄" : "›";
  span.title = open ? "Fold" : "Unfold";
  return span;
}

/** F2 on a `\label`, a `\ref` or a `\cite`: the rename, the way every
 *  editor with a rename binds it.  Anywhere else the key does nothing. */
function renameKey(onSymbol: OnSymbol): Extension {
  return keymap.of([{
    key: "F2",
    run: (view) => {
      const head = view.state.selection.main.head;
      const line = view.state.doc.lineAt(head);
      const link = linkAt(line.text, head - line.from);
      const kind = link?.kind === "ref" ? "label" : link?.kind === "cite" ? "cite" : null;
      if (!link || !kind) return false;
      onSymbol(kind, link.name, true);
      return true;
    },
  }]);
}

function base(): Extension[] {
  return [
    keymapCompartment.of([]),
    lineNumbers(),
    // The fold markers, drawn only where `latexFolding` answers, and a
    // placeholder that says how much is hidden rather than an ellipsis.
    // `foldKeymap` is Mod-Shift-[ and Mod-Shift-] to fold and unfold the
    // section or environment the caret is in, and Mod-Alt-[ and ] for
    // everything at once.
    foldGutter({ markerDOM: foldMarker }),
    codeFolding({
      placeholderDOM: (_view, onclick, prepared) => {
        const span = document.createElement("span");
        span.className = "cm-foldPlaceholder";
        span.textContent = prepared ? `${prepared} lines` : "…";
        span.title = "Unfold";
        span.setAttribute("aria-label", "folded lines");
        span.onclick = onclick;
        return span;
      },
      preparePlaceholder: (state, range) =>
        state.doc.lineAt(range.to).number - state.doc.lineAt(range.from).number,
    }),
    drawSelection(),
    highlightSpecialChars(),
    highlightActiveLine(),
    highlightActiveLineGutter(),
    highlightSelectionMatches(),
    // Several selections at once, which is what a column is.
    // `rectangularSelection()` had been installed for a year and did
    // nothing: without this facet every multi-range selection is reduced
    // to its main range before it is drawn, so an Alt-drag collapsed to a
    // single caret. The crosshair is the cue that Alt is held.
    EditorState.allowMultipleSelections.of(true),
    rectangularSelection(),
    crosshairCursor(),
    bracketMatching(),
    // Ahead of `closeBrackets`, which is the extension it overrules: a
    // dollar with a backslash in front of it is a currency sign and must
    // not be given a closer.  `closeBrackets` decides by what follows the
    // caret and there is nothing after a price at the end of a sentence,
    // so `\$100 in all.` came out with a stray `$` on the end of it.
    EditorView.inputHandler.of((view, from, to, text) => {
      if (text !== "$" || from !== to) return false;
      const line = view.state.doc.lineAt(from);
      if (!isEscaped(line.text, from - line.from)) return false;
      view.dispatch({
        changes: { from, insert: "$" },
        selection: { anchor: from + 1 },
        scrollIntoView: true,
        userEvent: "input.type",
      });
      return true;
    }),
    closeBrackets(),
    // The keymap alone was bound, which meant Ctrl-F installed the search
    // extension and opened nothing: the panel field is added by the same
    // transaction that asks to show it, and a field added in a transaction
    // does not see that transaction's effects.  The second press worked.
    // A LaTeX editor with no find and replace, one line away from having it.
    search({ top: true }),
    keymap.of([
      ...closeBracketsKeymap,
      // Ahead of the default Enter, and it only claims the key when there
      // is a block to close: everywhere else it returns false and the
      // default runs. A `\begin{figure}` typed by hand never produced its
      // `\end{figure}`; that happened only when the completion list was
      // used, which is the case where the writer already knew the name.
      { key: "Enter", run: closeEnvironment },
      // Without its Mod-Enter, which inserts a blank line: that chord is
      // the app's, reveal on the page or run the script, and the app
      // yields to a key the editor has answered, so the editor's own
      // binding took the key and a script stopped running from the
      // keyboard. Before the app yielded, both ran, and every Ctrl-Enter
      // run left a blank line under the caret that nobody noticed.
      ...defaultKeymap.filter((binding) => binding.key !== "Mod-Enter"),
      ...searchKeymap,
      // Ahead of `indentWithTab`, which would otherwise take the key.
      // `acceptCompletion` returns false when no list is open or nothing
      // in it is selected, so a Tab typed anywhere else still indents.
      // The completion keymap binds Enter alone, and a writer whose hands
      // know Tab from every other editor pressed it and got an indent in
      // front of the half-typed command.
      { key: "Tab", run: acceptCompletion },
      indentWithTab,
      // A second chord for the two cursor commands `defaultKeymap` binds
      // to Ctrl-Alt-Up and Ctrl-Alt-Down: GNOME takes those for switching
      // workspaces on many installs, and some window managers take
      // Alt-drag before the browser sees it, so a table needs a route to
      // a column that no desktop is sitting on.
      { key: "Mod-Shift-Alt-ArrowUp", run: addCursorAbove },
      { key: "Mod-Shift-Alt-ArrowDown", run: addCursorBelow },
      // Ahead of `foldKeymap`'s own binding for the same chord, which
      // folds only a range starting on the caret's line.
      { key: "Mod-Shift-[", run: foldEnclosing },
      ...foldKeymap,
    ]),
    syntaxHighlighting(latexHighlight),
    // Empty until the writer asks for spell checking, and filled by a
    // dynamic import when they do: the checker and its word list are a
    // hundred kilobytes that an editor with the setting off should never
    // pay for, in bytes or in work per keystroke.
    spellCompartment.of([]),
    EditorView.lineWrapping,
    // The document is an ARIA textbox; without a name it is announced as an
    // unlabelled input, which is the least useful thing to hear about the
    // one region of this app that holds the writing.
    EditorView.contentAttributes.of({ "aria-label": "The document source" }),
  ];
}

/** What the language compartment holds for a file at `path`.
 *
 *  `complete` is false for the read-only panes, which never offered
 *  completions; `follow` is absent there too, since following a reference
 *  out of a version being read is a jump with no way back. */
export function languageFor(
  path: string,
  symbols: () => Symbols | null,
  options: {
    follow?: (path: string, line?: number) => void;
    complete?: boolean;
    /** Where a figure's bytes are, for the hover on `\includegraphics`. */
    imageUrl?: (path: string) => string;
    /** The tooltip's Find references and Rename, and F2 on a name. */
    onSymbol?: OnSymbol;
  } = {},
): Extension[] {
  if (isScript(path)) {
    return [
      PYTHON,
      syntaxHighlighting(pythonHighlight),
      // Four spaces, which is what the seeded helper and every script the
      // agent writes use, and what Tab inserts.
      indentUnit.of("    "),
    ];
  }
  if (isBib(path)) {
    // The stex mode reads a .bib well enough: braces pair and a field name
    // is a word.  What a .bib needs of its own is the completion, since a
    // LaTeX source offers \commands to a file that has none.
    return [
      LATEX,
      LATEX.data.of({ closeBrackets: { brackets: ["(", "[", "{", '"'] } }),
      familyHighlight,
      ...(options.complete ? [bibCompletions()] : []),
    ];
  }
  return [
    LATEX,
    // `$` is the character a LaTeX writer types most after a letter, and
    // `closeBrackets()` reads its set from the language rather than from
    // its own options, so a stock stex mode pairs ( [ { ' " and leaves
    // maths out. The language's own data is where that answer belongs.
    LATEX.data.of({
      closeBrackets: { brackets: ["(", "[", "{", "'", '"', "$"] },
    }),
    familyHighlight,
    // Sections and environments fold; see `folds.ts`.  Here rather than
    // in `base()` so a Python script, which has no sections, gets no
    // gutter, and the read-only version view folds like the live one.
    latexFolding(),
    mathHover(symbols, options.imageUrl, options.onSymbol),
    ...(options.onSymbol ? [renameKey(options.onSymbol)] : []),
    ...(options.follow ? [followLinks(symbols, options.follow)] : []),
    ...(options.complete ? [latexCompletions(symbols)] : []),
  ];
}

export function extensions(
  /** `local` is false when the change arrived from the shared document
   *  rather than from this keyboard -- a collaborator typing, or the first
   *  sync when a file is opened. The caller needs to tell them apart: a
   *  keystroke here means the preview is behind before the server has heard
   *  about it, and a change from anywhere else is already the server's news
   *  to tell. */
  onChange: (local: boolean) => void,
  onCursor: (
    line: number,
    column: number,
    selection: string,
    /** The lines the selection covers, so a question about it can say
     *  where it is. Null when nothing is selected. */
    span: { fromLine: number; toLine: number } | null,
  ) => void,
  /** The annotation the Yjs binding marks its own transactions with. A ref
   *  rather than a value: the binding is imported on demand, long after
   *  these extensions are built. */
  remote?: { current: unknown },
): Extension[] {
  return [
    ...base(),
    markField,
    flashField,
    EditorView.updateListener.of((update) => {
      if (update.docChanged) {
        const marker = remote?.current as any;
        const fromElsewhere = Boolean(marker) && update.transactions.some(
          (transaction) => transaction.annotation(marker) !== undefined,
        );
        onChange(!fromElsewhere);
      }
      if (update.selectionSet || update.docChanged) {
        const range = update.state.selection.main;
        const line = update.state.doc.lineAt(range.head);
        // The selection goes with the position: "rewrite this" needs to
        // know what "this" is, and the agent should not have to guess.
        const selection = range.empty
          ? ""
          : update.state.sliceDoc(range.from, range.to).slice(0, 20000);
        const span = range.empty
          ? null
          : {
              fromLine: update.state.doc.lineAt(range.from).number,
              toLine: update.state.doc.lineAt(range.to).number,
            };
        onCursor(line.number, range.head - line.from + 1, selection, span);
      }
    }),
  ];
}

/** For showing an old version.
 *
 *  The update listener is *absent*, not disabled.  That listener is what
 *  arms the autosave, and the one unacceptable failure here is writing
 *  last week's chapter over today's: with no listener in the state, no
 *  dispatch of any kind can start a save.  readOnly and editable are the
 *  second and third locks on the same door.
 */
export function viewExtensions(): Extension[] {
  return [
    ...base(),
    ...withHistory(),
    diffField,
    EditorState.readOnly.of(true),
    EditorView.editable.of(false),
  ];
}

/** CodeMirror's own undo, for the panes that have no shared document
 *  behind them: a version being read, and the read-only fallback a file
 *  gets when it could not be connected.  Nothing in either can be edited,
 *  so this exists to answer Ctrl+Z rather than let the browser have it.
 *
 *  The live editor must not have this.  Its undo arrives with `yCollab`,
 *  which installs the scoped `Y.UndoManager` and, since R-029, the keymap
 *  that reaches it.
 */
function withHistory(): Extension[] {
  return [history(), keymap.of(historyKeymap)];
}

export function freshState(
  text: string,
  ext: Extension[],
  language: Extension[] = [],
): EditorState {
  return EditorState.create({
    doc: text,
    extensions: [...ext, languageCompartment.of(language)],
  });
}
