/** What TeX never reads: everything after `\end{document}`.
 *
 *  TeX stops at `\end{document}` and ignores the rest without a word, so
 *  a section typed below it builds cleanly and appears nowhere. The probe
 *  of September 2026 made exactly that slip on its first writer journey,
 *  as the review before it had (Q-065). The rest of the file is drawn in
 *  the third ink, and one quiet line under `\end{document}` says why. It
 *  was a hover card first, as the direction page drew it; a card there
 *  opened beside the reference and formula cards over the same text, so
 *  the sentence is a line of its own that nothing can cover.
 */
import { RangeSetBuilder, StateField, Text, type Extension } from "@codemirror/state";
import { reshapes } from "../folds";
import { Decoration, type DecorationSet, EditorView, WidgetType } from "@codemirror/view";

/** Where the ignored text begins: just after the first `\end{document}`
 *  that is not in a comment, or -1 when there is none or nothing after
 *  it but blank space. */
export function ignoredFrom(text: string): number {
  return ignoredIn(Text.of(text.split("\n")));
}

/** The same, read line by line from the editor's own text.  It took the
 *  whole document as one string on every keystroke, which in a long
 *  thesis was a copy of every character per key.  `\end{document}` is
 *  looked for only on lines that hold `\end`. */
export function ignoredIn(doc: Text): number {
  const pattern = /\\end\s*\{document\}/g;
  let pos = 0;
  for (const iter = doc.iterLines(); !iter.next().done; ) {
    const line = iter.value;
    const start = pos;
    pos += line.length + 1;
    if (!line.includes("\\end")) continue;
    pattern.lastIndex = 0;
    for (const found of line.matchAll(pattern)) {
      const at = found.index ?? 0;
      // A `%` not escaped as `\%` comments the rest of the line out.
      if (/(^|[^\\])%/.test(line.slice(0, at))) continue;
      const after = start + at + found[0].length;
      return restIsBlank(doc, after) ? -1 : after;
    }
  }
  return -1;
}

function restIsBlank(doc: Text, from: number): boolean {
  for (const iter = doc.iterRange(from); !iter.next().done; ) {
    if (iter.value.trim()) return false;
  }
  return true;
}

class Note extends WidgetType {
  eq() {
    return true;
  }
  toDOM() {
    const line = document.createElement("div");
    line.className = "nx-after-end-note";
    line.dataset.testid = "after-end-note";
    line.textContent = "TeX ignores everything below \\end{document}. Move these lines above it to have them typeset.";
    return line;
  }
  ignoreEvent() {
    return true;
  }
}

// Inclusive at its end, so text typed at the very end of the file, which
// the mark is carried through rather than rebuilt for, is faint too.
const faint = Decoration.mark({ class: "nx-after-end", inclusiveEnd: true });

function build(doc: Text): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  const from = ignoredIn(doc);
  if (from >= 0) {
    // The note under the line that ends the document, then the rest in
    // the third ink.
    const end = doc.lineAt(from).to;
    builder.add(end, end, Decoration.widget({ widget: new Note(), side: 1, block: true }));
    if (end < doc.length) builder.add(end, doc.length, faint);
  }
  return builder.finish();
}

/** A state field rather than a view plugin, since CodeMirror takes a block
 *  widget, the note's own line, only from state.  Typing in a plain line
 *  cannot make or unmake an `\end{document}` or the text after it, so it
 *  carries the marks through the edit, by the folds' own test. */
const marks = StateField.define<DecorationSet>({
  create: (state) => build(state.doc),
  update(value, tr) {
    if (!tr.docChanged) return value;
    if (!reshapes(tr.changes, tr.startState.doc, tr.state.doc)) return value.map(tr.changes);
    return build(tr.state.doc);
  },
  provide: (field) => EditorView.decorations.from(field),
});

export function afterEndOfDocument(): Extension {
  return marks;
}
