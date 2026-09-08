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
  drawSelection,
  highlightActiveLine,
  highlightActiveLineGutter,
  highlightSpecialChars,
  keymap,
  lineNumbers,
  rectangularSelection,
} from "@codemirror/view";
import {
  defaultKeymap,
  history,
  historyKeymap,
  indentWithTab,
} from "@codemirror/commands";
import { search, searchKeymap, highlightSelectionMatches } from "@codemirror/search";
import {
  HighlightStyle,
  bracketMatching,
  StreamLanguage,
  syntaxHighlighting,
} from "@codemirror/language";
import { tags } from "@lezer/highlight";
import { stex } from "@codemirror/legacy-modes/mode/stex";
import { closeBrackets, closeBracketsKeymap } from "@codemirror/autocomplete";
import type { Diagnostic, Symbols } from "../api";
import { latexCompletions } from "./latex-complete";
import { mathHover } from "./math-hover";
import {
  braceAfter,
  commentStart,
  familyOf,
  familyOfEnvironment,
  inlineMath,
  TITLED,
} from "./latex-families";

/** Near-monochrome by default.  The rendered page is two panes away, and a
 *  rainbow of token colours beside it makes the source look like the louder
 *  object, so weight and italics carry the structure here and the reserved
 *  accents stay out of the text entirely.
 *
 *  Colouring control sequences by family is offered as a setting on top of
 *  this rather than instead of it -- see `commandFamilies` below and the
 *  `--syn-*` tokens in styles.css.  These tags cover what is left: the
 *  comments, the braces and the literals, which have no family. */
const latexHighlight = HighlightStyle.define([
  { tag: tags.comment, color: "var(--ink-3)", fontStyle: "italic" },
  { tag: tags.keyword, color: "var(--ink)", fontWeight: "600" },
  { tag: tags.tagName, color: "var(--ink)", fontWeight: "600" },
  { tag: tags.atom, color: "var(--ink-2)" },
  { tag: tags.string, color: "var(--ink-2)" },
  { tag: tags.bracket, color: "var(--ink-3)" },
  { tag: tags.number, color: "var(--ink-2)" },
  { tag: tags.variableName, color: "var(--ink-2)" },
  { tag: tags.typeName, color: "var(--ink-2)" },
  { tag: tags.emphasis, fontStyle: "italic" },
  { tag: tags.strong, fontWeight: "600" },
]);

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

/** Everything both the live editor and a historical view want. */
function base(symbols: () => Symbols | null): Extension[] {
  return [
    lineNumbers(),
    history(),
    drawSelection(),
    highlightSpecialChars(),
    highlightActiveLine(),
    highlightActiveLineGutter(),
    highlightSelectionMatches(),
    rectangularSelection(),
    bracketMatching(),
    closeBrackets(),
    // The keymap alone was bound, which meant Ctrl-F installed the search
    // extension and opened nothing: the panel field is added by the same
    // transaction that asks to show it, and a field added in a transaction
    // does not see that transaction's effects.  The second press worked.
    // A LaTeX editor with no find and replace, one line away from having it.
    search({ top: true }),
    keymap.of([
      ...closeBracketsKeymap,
      ...defaultKeymap,
      ...historyKeymap,
      ...searchKeymap,
      indentWithTab,
    ]),
    StreamLanguage.define(stex),
    syntaxHighlighting(latexHighlight),
    familyHighlight,
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
    mathHover(symbols),
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
  onCursor: (line: number, column: number, selection: string) => void,
  symbols: () => Symbols | null,
  /** The annotation the Yjs binding marks its own transactions with. A ref
   *  rather than a value: the binding is imported on demand, long after
   *  these extensions are built. */
  remote?: { current: unknown },
): Extension[] {
  return [
    ...base(symbols),
    latexCompletions(symbols),
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
        onCursor(line.number, range.head - line.from + 1, selection);
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
export function viewExtensions(symbols: () => Symbols | null): Extension[] {
  return [
    ...base(symbols),
    diffField,
    EditorState.readOnly.of(true),
    EditorView.editable.of(false),
  ];
}

export function freshState(text: string, ext: Extension[]): EditorState {
  return EditorState.create({ doc: text, extensions: ext });
}
