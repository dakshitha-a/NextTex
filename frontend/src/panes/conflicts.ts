/** Two versions of a paragraph, chosen in place.
 *
 *  When two installs wrote the same paragraph apart, or a file changed on
 *  disk while it was typed in, the server's paragraph merge keeps both
 *  versions between comment lines (`server/collab/paragraphs.py`), so the
 *  file still compiles and nothing is lost. Here those comment lines are
 *  drawn as a quiet bar: one row saying what happened with "Keep both",
 *  one row per version with "Keep this one", and the closing line hidden.
 *  A click is one change to the buffer, so the shared document carries it
 *  to everyone. The marker lines stay plain comments in the file, so a
 *  writer in another editor can resolve one by hand just as well.
 */
import { RangeSetBuilder, StateField, type EditorState, type Extension } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView, WidgetType } from "@codemirror/view";

/** A marker line's tag, at the end of the line: the id, then nothing for
 *  the opening line, a number for a version, or `end`. */
const TAG = /\{nexttex-conflict ([0-9a-f]+)(?: (\d+|end))?\}/;

export interface Version {
  /** The marker line's text, cut to its words: "Version from Alice". */
  label: string;
  /** Offsets of the marker line. */
  lineFrom: number;
  lineTo: number;
  /** The version's own text, from the line after the marker to the start
   *  of the next marker line. */
  from: number;
  to: number;
}

export interface Conflict {
  id: string;
  /** "Two versions of this paragraph were written apart." */
  sentence: string;
  /** The whole region, from the opening line's start to the end of the
   *  closing line, its line break included. */
  from: number;
  to: number;
  headerTo: number;
  endFrom: number;
  versions: Version[];
}

/** The words of a marker line: what is between the comment's opening and
 *  the tag, whichever comment form the file uses. */
function wordsOf(line: string): string {
  const cut = line.replace(TAG, "").replace(/-->\s*$/, "");
  return cut.replace(/^\s*(%|#|<!--)\s?/, "").trim();
}

/** The conflicts in a document, complete ones only: an opening line, one
 *  line per version in order, and a closing line, all with one id. */
export function conflictsIn(state: EditorState): Conflict[] {
  const doc = state.doc;
  const found: Conflict[] = [];
  let open: { id: string; sentence: string; from: number; headerTo: number; versions: Version[] } | null = null;
  for (let number = 1; number <= doc.lines; number++) {
    const line = doc.line(number);
    const match = TAG.exec(line.text);
    if (!match) continue;
    const [, id, kind] = match;
    if (kind === undefined) {
      const sentence = wordsOf(line.text)
        .replace(/^NextTex:\s*/, "")
        .replace(/\s*Keep one\.$/, "");
      open = { id, sentence: sentence.charAt(0).toUpperCase() + sentence.slice(1), from: line.from, headerTo: line.to, versions: [] };
      continue;
    }
    if (!open || open.id !== id) {
      open = null;
      continue;
    }
    const last = open.versions[open.versions.length - 1];
    if (last) last.to = line.from;
    if (kind === "end") {
      if (open.versions.length >= 2) {
        const to = line.to < doc.length ? line.to + 1 : line.to;
        found.push({ ...open, to, endFrom: line.from });
      }
      open = null;
      continue;
    }
    if (Number(kind) !== open.versions.length + 1) {
      open = null;
      continue;
    }
    const from = line.to < doc.length ? line.to + 1 : line.to;
    open.versions.push({ label: wordsOf(line.text), lineFrom: line.from, lineTo: line.to, from, to: from });
  }
  return found;
}

/** Keep one version: the whole region becomes that version's text. */
export function keepOne(view: EditorView, conflict: Conflict, index: number): void {
  const version = conflict.versions[index];
  view.dispatch({
    changes: { from: conflict.from, to: conflict.to, insert: view.state.sliceDoc(version.from, version.to) },
    userEvent: "input.conflict",
  });
}

/** Keep both: only the marker lines go. */
export function keepBoth(view: EditorView, conflict: Conflict): void {
  const doc = view.state.doc;
  const lineWithBreak = (from: number, to: number) => ({ from, to: to < doc.length ? to + 1 : to });
  view.dispatch({
    changes: [
      lineWithBreak(conflict.from, conflict.headerTo),
      ...conflict.versions.map((version) => lineWithBreak(version.lineFrom, version.lineTo)),
      { from: conflict.endFrom, to: conflict.to },
    ],
    userEvent: "input.conflict",
  });
}

function button(label: string, testid: string, act: (view: EditorView) => void, view: EditorView): HTMLButtonElement {
  const control = document.createElement("button");
  control.type = "button";
  control.className = "nx-button";
  control.dataset.variant = "quiet";
  control.dataset.size = "inline";
  control.dataset.testid = testid;
  control.textContent = label;
  control.addEventListener("mousedown", (event) => event.preventDefault());
  control.addEventListener("click", () => act(view));
  return control;
}

/** One row of the bar. The conflict is found again at click time by its
 *  id, since the offsets drawn may have moved since. */
class Row extends WidgetType {
  constructor(
    readonly id: string,
    readonly text: string,
    readonly kind: "head" | number,
  ) {
    super();
  }
  eq(other: Row) {
    return other.id === this.id && other.text === this.text && other.kind === this.kind;
  }
  toDOM(view: EditorView) {
    const row = document.createElement("div");
    row.className = this.kind === "head" ? "nx-conflict-head" : "nx-conflict-version";
    row.dataset.testid = this.kind === "head" ? "conflict-head" : "conflict-version";
    const words = document.createElement("span");
    words.textContent = this.text;
    row.append(words);
    const current = () => conflictsIn(view.state).find((each) => each.id === this.id);
    if (this.kind === "head") {
      row.append(button("Keep both", "conflict-keep-both", (v) => {
        const conflict = current();
        if (conflict) keepBoth(v, conflict);
      }, view));
    } else {
      const index = this.kind;
      row.append(button("Keep this one", "conflict-keep-this", (v) => {
        const conflict = current();
        if (conflict) keepOne(v, conflict, index);
      }, view));
    }
    return row;
  }
  ignoreEvent() {
    return true;
  }
}

const inside = Decoration.line({ class: "nx-conflict-line" });
const hidden = Decoration.replace({ block: true });

function build(state: EditorState): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  for (const conflict of conflictsIn(state)) {
    // Decorations go in in document order: each marker line is replaced
    // by its row, and each line of a version's text carries the rule.
    builder.add(conflict.from, conflict.headerTo, Decoration.replace({
      block: true, widget: new Row(conflict.id, conflict.sentence, "head"),
    }));
    conflict.versions.forEach((version, index) => {
      if (version.lineFrom !== conflict.from) {
        builder.add(version.lineFrom, version.lineTo, Decoration.replace({
          block: true, widget: new Row(conflict.id, version.label, index),
        }));
      }
      for (let at = version.from; at < version.to;) {
        const line = state.doc.lineAt(at);
        builder.add(line.from, line.from, inside);
        at = line.to + 1;
      }
    });
    builder.add(conflict.endFrom, conflict.to > conflict.endFrom && state.sliceDoc(conflict.to - 1, conflict.to) === "\n" ? conflict.to - 1 : conflict.to, hidden);
  }
  return builder.finish();
}

const MARK = "nexttex-conflict";

/** A state field, since CodeMirror takes block decorations only from
 *  state. A chapter is walked line by line only when a conflict is drawn
 *  already or a change brought a marker in, so a keystroke in a long file
 *  with none costs a glance at what it inserted. */
const bars = StateField.define<DecorationSet>({
  create: (state) => (state.doc.toString().includes(MARK) ? build(state) : Decoration.none),
  update(value, tr) {
    if (!tr.docChanged) return value;
    let brought = false;
    tr.changes.iterChanges((_fromA, _toA, _fromB, _toB, inserted) => {
      if (!brought && inserted.length >= MARK.length && inserted.toString().includes(MARK)) brought = true;
    });
    return value.size || brought ? build(tr.state) : value;
  },
  provide: (field) => EditorView.decorations.from(field),
});

export function conflictBars(): Extension {
  return bars;
}
