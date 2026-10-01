import { describe, expect, test } from "vitest";
import { ignoredFrom } from "./after-end";

describe("what TeX never reads", () => {
  // Q-065: three lines typed after \end{document} built cleanly and
  // appeared nowhere, and nothing said why.
  test("text after \\end{document} is found", () => {
    const text = "\\begin{document}\nHi.\n\\end{document}\n\\section{Outlook}\n";
    expect(text.slice(ignoredFrom(text))).toBe("\n\\section{Outlook}\n");
  });
  test("blank space after it is not worth a mark", () => {
    expect(ignoredFrom("\\begin{document}\n\\end{document}\n\n  \n")).toBe(-1);
  });
  test("a commented \\end{document} is not the end", () => {
    const text = "% \\end{document}\n\\begin{document}\nA.\n\\end{document}\nB.";
    expect(text.slice(ignoredFrom(text))).toBe("\nB.");
  });
  test("an escaped percent sign does not comment it out", () => {
    const text = "50\\% done \\end{document}\nafter";
    expect(text.slice(ignoredFrom(text))).toBe("\nafter");
  });
  test("a file with no \\end{document} has nothing ignored", () => {
    expect(ignoredFrom("\\section{Two}\nA chapter.\n")).toBe(-1);
  });
});

describe("the faint text carried through typing", () => {
  const sample = "\\begin{document}\nProse.\n\\end{document}\nLeft below.\nAnd more.";

  /** After every possible keystroke, what is marked is what a fresh
   *  computation marks, whether the marks were carried or rebuilt. */
  test("agrees with a fresh computation after every possible keystroke", async () => {
    const { EditorState } = await import("@codemirror/state");
    const { EditorView } = await import("@codemirror/view");
    const { afterEndOfDocument } = await import("./after-end");
    const answer = (state: import("@codemirror/state").EditorState) => {
      const out: string[] = [];
      for (const source of state.facet(EditorView.decorations)) {
        const set = typeof source === "function" ? null : source;
        set?.between(0, state.doc.length, (from, to, value) => {
          out.push(`${from}-${to}:${value.spec.class ?? "note"}`);
        });
      }
      return out.join(" ");
    };
    const base = EditorState.create({ doc: sample, extensions: afterEndOfDocument() });
    expect(answer(base)).toContain("nx-after-end");
    for (let at = 0; at <= sample.length; at++) {
      for (const insert of ["x", " ", "\\", "%", "\n"]) {
        const next = base.update({ changes: { from: at, insert } }).state;
        const fresh = EditorState.create({ doc: next.doc, extensions: afterEndOfDocument() });
        expect(answer(next), `insert ${JSON.stringify(insert)} at ${at}`).toBe(answer(fresh));
      }
    }
  });
});
