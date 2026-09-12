// Spell checking the prose in a LaTeX document.
//
// Three things have to be true or this is worse than nothing.  It must not
// underline the parts of the file that are not English -- that is
// `spell-scan.ts`, and it is most of the work.  It must not cost anything
// when it is off, so the word list is behind a dynamic import and the
// decorations are not computed at all unless asked for.  And the writer
// must be able to say "that word is fine", permanently, because a
// dissertation is full of words no list holds.

import { RangeSetBuilder, StateEffect, StateField } from "@codemirror/state";
import {
  Decoration,
  type DecorationSet,
  EditorView,
  ViewPlugin,
  type ViewUpdate,
} from "@codemirror/view";
import { normalise, proseWords, skippedLines } from "./spell-scan";

export type Spelling = {
  on: boolean;
  /** The writer's own words, as they were typed.  Normalised in here, so
   *  that the one place that decides what two spellings have in common is
   *  the same place that does the looking up. */
  custom: string[];
};

/** Turn checking on or off, or hand it a new list of accepted words. */
export const setSpelling = StateEffect.define<Spelling>();
/** The word list has arrived; recompute against it. */
const dictionaryReady = StateEffect.define<null>();

type Resolved = { on: boolean; custom: Set<string> };

const spelling = StateField.define<Resolved>({
  create: () => ({ on: false, custom: new Set<string>() }),
  update(value, tr) {
    for (const effect of tr.effects) {
      if (effect.is(setSpelling)) {
        return {
          on: effect.value.on,
          custom: new Set(effect.value.custom.map(normalise).filter(Boolean)),
        };
      }
    }
    return value;
  },
});

// Module scope rather than editor scope: one page, one copy of the list,
// however many editors are built over the life of the tab.
let words: Set<string> | null = null;
let loading = false;

function load(view: EditorView): void {
  if (words || loading) return;
  loading = true;
  import("../dictionary/words")
    .then((module) => {
      words = module.dictionary();
      // The editor is already mounted and showing nothing; tell it the
      // ground has moved rather than waiting for the next keystroke.
      view.dispatch({ effects: dictionaryReady.of(null) });
    })
    .catch(() => {
      // No list, no underlines.  A failed chunk must not take the editor
      // down with it, and there is nothing useful to say about it here.
      loading = false;
    });
}

/** What the writer probably meant, re-exported so that it travels in this
 *  chunk: the search is only useful once the word list is here, and the
 *  word list is only here because this module was loaded. */
export { suggest as suggestions } from "./spell-suggest";

/** The shipped list, once it has loaded, for anything that needs to ask it
 *  a question the underlines do not answer.
 *
 *  Null until the chunk arrives, which is the honest answer rather than an
 *  empty set: "no suggestions" and "the list is not here yet" are different
 *  states and the menu draws them differently. */
export function shipped(): Set<string> | null {
  return words;
}

/** Whether a word is one the list, or the writer, does not know.
 *
 *  A hyphenated compound is judged on its parts: no list holds
 *  `excited-state`, and both halves are ordinary words. */
export function unknown(word: string, custom: Set<string>): boolean {
  if (!words) return false;
  const clean = normalise(word);
  if (!clean) return false;
  if (words.has(clean) || custom.has(clean)) return false;
  if (clean.includes("-")) {
    return !clean
      .split("-")
      .filter((part) => part.length > 0)
      .every((part) => part.length < 3 || words!.has(part) || custom.has(part));
  }
  return true;
}

function misspellings(
  view: EditorView,
  custom: Set<string>,
  skip: Set<number>,
): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  let lastLine = -1;
  for (const range of view.visibleRanges) {
    let pos = range.from;
    while (pos <= range.to) {
      const line = view.state.doc.lineAt(pos);
      if (line.number === lastLine) { pos = line.to + 1; continue; }
      lastLine = line.number;
      // Inside a displayed equation or a listing, which began on some
      // earlier line and may not end for fifty more.
      if (skip.has(line.number)) { pos = line.to + 1; continue; }
      for (const found of proseWords(line.text)) {
        if (!unknown(found.word, custom)) continue;
        builder.add(
          line.from + found.from,
          line.from + found.to,
          // The word travels with the mark so that the menu offering to
          // accept it does not have to work out what was clicked.
          Decoration.mark({
            class: "nx-misspelled",
            attributes: { "data-word": found.word },
          }),
        );
      }
      pos = line.to + 1;
    }
  }
  return builder.finish();
}

const checker = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet = Decoration.none;
    /** Which lines are inside a multi-line equation or listing.
     *
     *  Whether a line is inside one is not a fact about that line, so it
     *  cannot be worked out from the visible range alone -- an `\end{align}`
     *  may be a thousand lines below the `\begin`.  Recomputed when the
     *  document changes and cached across scrolling, which is the common
     *  case by far. */
    private skip: Set<number> = new Set();
    constructor(private readonly view: EditorView) {
      this.sync(true);
    }
    update(update: ViewUpdate) {
      const told = update.transactions.some((tr) =>
        tr.effects.some((e) => e.is(setSpelling) || e.is(dictionaryReady)),
      );
      if (update.docChanged || update.viewportChanged || told) {
        this.sync(update.docChanged || told);
      }
    }
    sync(rescan: boolean) {
      const state = this.view.state.field(spelling);
      if (!state.on) {
        this.decorations = Decoration.none;
        this.skip = new Set();
        return;
      }
      if (!words) {
        load(this.view);
        this.decorations = Decoration.none;
        return;
      }
      if (rescan || !this.skip) {
        const doc = this.view.state.doc;
        const lines: string[] = [];
        for (let n = 1; n <= doc.lines; n += 1) lines.push(doc.line(n).text);
        this.skip = skippedLines(lines);
      }
      this.decorations = misspellings(this.view, state.custom, this.skip);
    }
  },
  { decorations: (plugin) => plugin.decorations },
);

export function spellchecking() {
  return [spelling, checker];
}
