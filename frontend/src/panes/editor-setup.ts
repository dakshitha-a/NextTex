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
import { searchKeymap, highlightSelectionMatches } from "@codemirror/search";
import {
  HighlightStyle,
  bracketMatching,
  StreamLanguage,
  syntaxHighlighting,
} from "@codemirror/language";
import { tags } from "@lezer/highlight";
import { stex } from "@codemirror/legacy-modes/mode/stex";
import { closeBrackets, closeBracketsKeymap } from "@codemirror/autocomplete";
import type { Diagnostic } from "../api";

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

export type Mark = { line: number; severity: "error" | "warning" };

export const setMarks = StateEffect.define<Mark[]>();
export const flashRange = StateEffect.define<{ from: number; to: number } | null>();
/** Drop the fading highlight once it has finished fading. */
export const clearFlash = StateEffect.define<null>();

const markField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(marks, tr) {
    for (const effect of tr.effects) {
      if (!effect.is(setMarks)) continue;
      const builder: any[] = [];
      const seen = new Set<number>();
      for (const mark of effect.value) {
        if (mark.line < 1 || mark.line > tr.state.doc.lines) continue;
        if (seen.has(mark.line)) continue;
        seen.add(mark.line);
        const line = tr.state.doc.line(mark.line);
        const cls = mark.severity === "error" ? "error" : "warn";
        builder.push(
          Decoration.line({ class: `cm-gutter-${cls}` }).range(line.from),
        );
        if (line.to > line.from) {
          builder.push(
            Decoration.mark({ class: `cm-mark-${cls}` }).range(line.from, line.to),
          );
        }
      }
      builder.sort((a, b) => a.from - b.from || a.value.startSide - b.value.startSide);
      return Decoration.set(builder, true);
    }
    return tr.docChanged ? marks.map(tr.changes) : marks;
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
): Mark[] {
  return diagnostics
    .filter((d) => d.file === path && d.line)
    .map((d) => ({
      line: d.line as number,
      severity: d.severity === "error" ? ("error" as const) : ("warning" as const),
    }));
}

export function extensions(
  onChange: () => void,
  onCursor: (line: number, column: number, selection: string) => void,
): Extension[] {
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

export function freshState(text: string, ext: Extension[]): EditorState {
  return EditorState.create({ doc: text, extensions: ext });
}
