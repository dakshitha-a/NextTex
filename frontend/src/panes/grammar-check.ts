// Grammar findings in the editor: a dashed underline, the same ink as a
// misspelling's dotted one, since one accent has one meaning, and the same
// menu. Part of the grammar chunk, so nothing here loads until grammar is
// switched on.
//
// Asked of the lines on screen, a moment after the typing or the scrolling
// settles, rather than of the whole document on every keystroke: Harper
// answers a screen of prose in tens of milliseconds, a thesis in seconds.

import { RangeSetBuilder, StateEffect, StateField, type Extension } from "@codemirror/state";
import { Decoration, EditorView, ViewPlugin, type DecorationSet, type ViewUpdate } from "@codemirror/view";
import { check, ignoreKey, proseOf, skippedLines, type Finding } from "./grammar";

export type { Finding };
export { ignoreKey };

/** What the checker is told: whether it is on, and the keys this project,
 *  or this sitting, says to leave alone. */
export const setGrammar = StateEffect.define<{ on: boolean; ignored: string[] }>();
const setFindings = StateEffect.define<Finding[]>();

type State = { on: boolean; ignored: Set<string>; findings: Finding[]; marks: DecorationSet };

function marksFor(findings: Finding[], length: number): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  const sorted = [...findings].sort((a, b) => a.from - b.from || a.to - b.to);
  let last = -1;
  sorted.forEach((finding) => {
    if (finding.from < last || finding.to > length) return;   // no overlaps
    builder.add(finding.from, finding.to, Decoration.mark({
      class: "nx-grammar",
      attributes: { "data-grammar": String(findings.indexOf(finding)) },
    }));
    last = finding.to;
  });
  return builder.finish();
}

const grammar = StateField.define<State>({
  create: () => ({ on: false, ignored: new Set(), findings: [], marks: Decoration.none }),
  update(value, tr) {
    let next = value;
    if (tr.docChanged && next.findings.length) {
      // Findings follow the text until the next answer replaces them; one
      // an edit swallowed goes.
      const findings = next.findings
        .map((finding) => ({
          ...finding,
          from: tr.changes.mapPos(finding.from, 1),
          to: tr.changes.mapPos(finding.to, -1),
        }))
        .filter((finding) => finding.to > finding.from);
      next = { ...next, findings, marks: marksFor(findings, tr.newDoc.length) };
    }
    for (const effect of tr.effects) {
      if (effect.is(setGrammar)) {
        const ignored = new Set(effect.value.ignored);
        const findings = effect.value.on
          ? next.findings.filter((finding) => !ignored.has(ignoreKey(finding)))
          : [];
        next = { on: effect.value.on, ignored, findings, marks: marksFor(findings, tr.newDoc.length) };
      } else if (effect.is(setFindings)) {
        const findings = next.on ? effect.value : [];
        next = { ...next, findings, marks: marksFor(findings, tr.newDoc.length) };
      }
    }
    return next;
  },
  provide: (field) => EditorView.decorations.from(field, (value) => value.marks),
});

/** How long the text or the scroll must settle before Harper is asked. */
const SETTLE = 600;

const asker = ViewPlugin.fromClass(
  class {
    private timer: number | null = null;
    private asked = 0;
    constructor(private readonly view: EditorView) {
      this.later();
    }
    update(update: ViewUpdate) {
      const told = update.transactions.some((tr) => tr.effects.some((e) => e.is(setGrammar)));
      if (update.docChanged || update.viewportChanged || told) this.later();
    }
    later() {
      if (this.timer !== null) window.clearTimeout(this.timer);
      this.timer = window.setTimeout(() => {
        this.timer = null;
        void this.ask();
      }, SETTLE);
    }
    async ask() {
      const view = this.view;
      const state = view.state.field(grammar);
      if (!state.on) return;
      const doc = view.state.doc;
      const ranges = view.visibleRanges;
      if (!ranges.length) return;
      const first = doc.lineAt(ranges[0].from).number;
      const last = doc.lineAt(ranges[ranges.length - 1].to).number;
      const all: string[] = [];
      for (let n = 1; n <= doc.lines; n += 1) all.push(doc.line(n).text);
      // Whether a line is inside a displayed equation is not a fact about
      // that line, so the whole document is read for it.
      const skip = skippedLines(all);
      const prose = proseOf(all.slice(first - 1, last), skip, first);
      const base = doc.line(first).from;
      const mine = (this.asked += 1);
      try {
        const findings = await check(prose, base, state.ignored);
        // A newer question, or an edit since, makes this answer stale.
        if (mine !== this.asked || view.state.doc !== doc) return;
        view.dispatch({ effects: setFindings.of(findings) });
      } catch {
        // Harper failed to load or to answer: no dashed lines, and spelling
        // is unaffected.
      }
    }
    destroy() {
      if (this.timer !== null) window.clearTimeout(this.timer);
    }
  },
);

export function grammarChecking(): Extension[] {
  return [grammar, asker];
}

/** The finding a `.nx-grammar` mark stands for. */
export function findingOf(view: EditorView, index: number): Finding | null {
  return view.state.field(grammar, false)?.findings[index] ?? null;
}
