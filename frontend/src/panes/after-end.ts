/** What TeX never reads: everything after `\end{document}`.
 *
 *  TeX stops at `\end{document}` and ignores the rest without a word, so
 *  a section typed below it builds cleanly and appears nowhere. The probe
 *  of September 2026 made exactly that slip on its first writer journey,
 *  as the review before it had (Q-065). The rest of the file is drawn
 *  dimmed, and resting on it says why, in the editor's hover card.
 */
import { RangeSetBuilder, type Extension } from "@codemirror/state";
import {
  Decoration,
  type DecorationSet,
  EditorView,
  ViewPlugin,
  type ViewUpdate,
  type Tooltip,
} from "@codemirror/view";
import { hoverCard } from "./hover-card";
import { shellTheme } from "../ui/FloatingCard";

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

const dim = Decoration.mark({ class: "nx-after-end" });

const marks = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = this.build(view);
    }
    update(update: ViewUpdate) {
      if (update.docChanged) this.decorations = this.build(update.view);
    }
    build(view: EditorView): DecorationSet {
      const builder = new RangeSetBuilder<Decoration>();
      const text = view.state.doc.toString();
      const from = ignoredFrom(text);
      if (from >= 0) builder.add(from, text.length, dim);
      return builder.finish();
    }
  },
  { decorations: (plugin) => plugin.decorations },
);

const explain = hoverCard((view, pos): Tooltip | null => {
  const text = view.state.doc.toString();
  const from = ignoredFrom(text);
  if (from < 0 || pos < from) return null;
  return {
    pos: from,
    end: text.length,
    create() {
      const dom = document.createElement("div");
      dom.className = `nx-card nx-after-end-card ${shellTheme()}`;
      dom.dataset.testid = "after-end-card";
      // One paragraph, so the words and the command flow as a sentence;
      // the card stacks its children.
      const said = document.createElement("p");
      said.style.margin = "0";
      said.append("TeX ignores everything after ");
      const code = document.createElement("code");
      code.textContent = "\\end{document}";
      said.append(code, ". Move these lines above it to have them typeset.");
      dom.append(said);
      return { dom };
    },
  };
});

export function afterEndOfDocument(): Extension {
  return [marks, explain];
}
