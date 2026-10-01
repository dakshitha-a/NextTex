import { describe, expect, it } from "vitest";
import { Text } from "@codemirror/state";
import { foldRanges } from "./folds";

/** The folds as line spans: the start line and the last line hidden. */
function spans(source: string): Record<number, [number, number]> {
  const doc = Text.of(source.split("\n"));
  const out: Record<number, [number, number]> = {};
  for (const [line, fold] of foldRanges(doc)) {
    out[line] = [doc.lineAt(fold.from).number, doc.lineAt(fold.to).number];
  }
  return out;
}

describe("sections", () => {
  it("a section folds to the line before the next section, blank lines left out", () => {
    const text = [
      "\\section{One}",     // 1
      "First.",             // 2
      "More.",              // 3
      "",                   // 4
      "\\section{Two}",     // 5
      "Second.",            // 6
    ].join("\n");
    expect(spans(text)).toEqual({ 1: [1, 3], 5: [5, 6] });
  });

  it("a subsection is inside its section, and the section's fold runs past it", () => {
    const text = [
      "\\section{One}",       // 1
      "Intro.",               // 2
      "\\subsection{A}",      // 3
      "In A.",                // 4
      "\\subsection{B}",      // 5
      "In B.",                // 6
      "\\section{Two}",       // 7
      "Two.",                 // 8
    ].join("\n");
    expect(spans(text)).toEqual({ 1: [1, 6], 3: [3, 4], 5: [5, 6], 7: [7, 8] });
  });

  it("the last section stops at \\end{document}", () => {
    const text = [
      "\\begin{document}",    // 1
      "\\section{Only}",      // 2
      "Text.",                // 3
      "",                     // 4
      "\\end{document}",      // 5
      "% trailing",           // 6
    ].join("\n");
    expect(spans(text)).toEqual({ 2: [2, 3] });
  });

  it("a starred heading and one with a short title fold too, and a commented one does not", () => {
    const text = [
      "\\section*{Unnumbered}",        // 1
      "a",                             // 2
      "% \\section{Not a heading}",    // 3
      "b",                             // 4
      "\\section[short]{Long title}",  // 5
      "c",                             // 6
    ].join("\n");
    expect(spans(text)).toEqual({ 1: [1, 4], 5: [5, 6] });
  });

  it("a heading with nothing under it has no fold", () => {
    expect(spans("\\section{Empty}\n\\section{Next}\nx")).toEqual({ 2: [2, 3] });
  });
});

describe("environments", () => {
  it("an environment folds to the line before its \\end, which stays visible", () => {
    const text = [
      "\\begin{table}",     // 1
      "\\centering",        // 2
      "a & b",              // 3
      "\\end{table}",       // 4
    ].join("\n");
    expect(spans(text)).toEqual({ 1: [1, 3] });
  });

  it("nested environments each fold their own body", () => {
    const text = [
      "\\begin{figure}",     // 1
      "\\begin{tabular}{c}", // 2
      "x",                   // 3
      "\\end{tabular}",      // 4
      "\\caption{c}",        // 5
      "\\end{figure}",       // 6
    ].join("\n");
    expect(spans(text)).toEqual({ 1: [1, 5], 2: [2, 3] });
  });

  it("an environment inside a section folds on its own and the section still folds over it", () => {
    const text = [
      "\\section{S}",         // 1
      "\\begin{itemize}",     // 2
      "\\item a",             // 3
      "\\end{itemize}",       // 4
      "after",                // 5
    ].join("\n");
    expect(spans(text)).toEqual({ 1: [1, 5], 2: [2, 3] });
  });

  it("a verbatim block is opaque: an \\end inside it closes nothing", () => {
    const text = [
      "\\begin{itemize}",     // 1
      "\\begin{verbatim}",    // 2
      "\\end{itemize}",       // 3  text, not a closing
      "\\section{Nope}",      // 4  text, not a heading
      "\\end{verbatim}",      // 5
      "\\item a",             // 6
      "\\end{itemize}",       // 7
    ].join("\n");
    expect(spans(text)).toEqual({ 1: [1, 6], 2: [2, 4] });
  });

  it("an unmatched \\begin folds nothing, an unmatched \\end is ignored, and one line folds nothing", () => {
    expect(spans("\\begin{a}\nx\n")).toEqual({});
    expect(spans("x\n\\end{a}\ny")).toEqual({});
    expect(spans("\\begin{a}x\\end{a}\ny")).toEqual({});
    expect(spans("\\begin{a}\n\\end{a}\ny")).toEqual({});
  });

  it("the document environment is not a fold", () => {
    expect(spans("\\begin{document}\nx\ny\n\\end{document}")).toEqual({});
  });
});

describe("folds carried through typing", () => {
  const sample = [
    "\\documentclass{article}",
    "\\begin{document}",
    "\\section{One}",
    "Prose that is typed into.",
    "",
    "\\begin{itemize}",
    "  item text here",
    "  more item text",
    "\\end{itemize}",
    "Closing prose of one.",
    "",
    "\\section{Two} % a comment",
    "Prose of two.",
    "\\end{document}",
  ].join("\n");

  /** Every single-character insertion and deletion anywhere in the
   *  sample: the field's answer must equal a fresh computation, whether it
   *  carried the folds or found them again. */
  it("agrees with a fresh computation after every possible keystroke", async () => {
    const { EditorState } = await import("@codemirror/state");
    const { latexFolding } = await import("./folds");
    const { foldService } = await import("@codemirror/language");
    const answer = (state: import("@codemirror/state").EditorState) => {
      const out: string[] = [];
      for (let n = 1; n <= state.doc.lines; n++) {
        for (const service of state.facet(foldService)) {
          const fold = service(state, state.doc.line(n).from, state.doc.line(n).to);
          if (fold) out.push(`${n}:${fold.from}-${fold.to}`);
        }
      }
      return out.join(" ");
    };
    const base = EditorState.create({ doc: sample, extensions: latexFolding() });
    for (let at = 0; at <= sample.length; at++) {
      for (const insert of ["x", " ", "\\", "%", "\n"]) {
        const next = base.update({ changes: { from: at, insert } }).state;
        const fresh = EditorState.create({ doc: next.doc, extensions: latexFolding() });
        expect(answer(next), `insert ${JSON.stringify(insert)} at ${at}`).toBe(answer(fresh));
      }
      if (at < sample.length) {
        const next = base.update({ changes: { from: at, to: at + 1 } }).state;
        const fresh = EditorState.create({ doc: next.doc, extensions: latexFolding() });
        expect(answer(next), `delete at ${at}`).toBe(answer(fresh));
      }
    }
  });

  it("typing in a plain line carries the folds; touching structure finds them again", async () => {
    const { EditorState, Text } = await import("@codemirror/state");
    const { reshapes } = await import("./folds");
    const doc = Text.of(sample.split("\n"));
    const state = EditorState.create({ doc });
    const prose = doc.line(4).from + 5;
    const plain = state.update({ changes: { from: prose, insert: "word " } });
    expect(reshapes(plain.changes, doc, plain.state.doc)).toBe(false);
    const slash = state.update({ changes: { from: prose, insert: "\\" } });
    expect(reshapes(slash.changes, doc, slash.state.doc)).toBe(true);
    const blankLine = doc.line(5).from;
    const filled = state.update({ changes: { from: blankLine, insert: "x" } });
    expect(reshapes(filled.changes, doc, filled.state.doc)).toBe(true);
  });
});
