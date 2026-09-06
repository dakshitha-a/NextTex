// CodeMirror wiring kept apart from React.  The view is created once and
// swapped between documents with `setState`, which is what makes tab
// switching land in the same frame and keeps per-file undo history intact.

import {
  EditorState,
  StateEffect,
  StateField,
  type Extension,
} from "@codemirror/state";
import {
  Decoration,
  type DecorationSet,
  EditorView,
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

/** Near-monochrome on purpose.  The rendered page is two panes away, and a
 *  rainbow of token colours beside it makes the source look like the louder
 *  object.  Weight and italics carry the structure; the accent stays
 *  reserved for the agent. */
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
    EditorView.lineWrapping,
    // The document is an ARIA textbox; without a name it is announced as an
    // unlabelled input, which is the least useful thing to hear about the
    // one region of this app that holds the writing.
    EditorView.contentAttributes.of({ "aria-label": "The document source" }),
    mathHover(symbols),
  ];
}

export function extensions(
  onChange: () => void,
  onCursor: (line: number, column: number, selection: string) => void,
  symbols: () => Symbols | null,
): Extension[] {
  return [
    ...base(symbols),
    latexCompletions(symbols),
    markField,
    flashField,
    EditorView.updateListener.of((update) => {
      if (update.docChanged) onChange();
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
