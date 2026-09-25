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
import { RangeSetBuilder, StateField, type Extension } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView, WidgetType } from "@codemirror/view";

/** Where the ignored text begins: just after the first `\end{document}`
 *  that is not in a comment, or -1 when there is none or nothing after
 *  it but blank space. */
export function ignoredFrom(text: string): number {
  const pattern = /\\end\s*\{document\}/g;
  for (const found of text.matchAll(pattern)) {
    const at = found.index ?? 0;
    const lineStart = text.lastIndexOf("\n", at - 1) + 1;
    const before = text.slice(lineStart, at);
    // A `%` not escaped as `\%` comments the rest of the line out.
    if (/(^|[^\\])%/.test(before)) continue;
    const after = at + found[0].length;
    return text.slice(after).trim() ? after : -1;
  }
  return -1;
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

const faint = Decoration.mark({ class: "nx-after-end" });

function build(text: string, lineEnd: (at: number) => number): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  const from = ignoredFrom(text);
  if (from >= 0) {
    // The note under the line that ends the document, then the rest in
    // the third ink.
    const end = lineEnd(from);
    builder.add(end, end, Decoration.widget({ widget: new Note(), side: 1, block: true }));
    if (end < text.length) builder.add(end, text.length, faint);
  }
  return builder.finish();
}

/** A state field rather than a view plugin, since CodeMirror takes a block
 *  widget, the note's own line, only from state. */
const marks = StateField.define<DecorationSet>({
  create: (state) => build(state.doc.toString(), (at) => state.doc.lineAt(at).to),
  update(value, tr) {
    if (!tr.docChanged) return value;
    const doc = tr.state.doc;
    return build(doc.toString(), (at) => doc.lineAt(at).to);
  },
  provide: (field) => EditorView.decorations.from(field),
});

export function afterEndOfDocument(): Extension {
  return marks;
}
