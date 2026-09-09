import { describe, expect, it, test } from "vitest";
import { CompletionContext } from "@codemirror/autocomplete";
import { EditorState } from "@codemirror/state";
import { COMMANDS, latexSource } from "./latex-complete";
import type { Symbols } from "../api";

/** Which list of completions, and whether there is one at all.
 *
 *  All of the interesting behaviour is that decision, and it is pure: what
 *  is before the cursor, and what the project contains.  No editor, no
 *  keystrokes, no DOM.
 */

const SYMBOLS: Symbols = {
  labels: [
    { name: "eq:gap", file: "main.tex", line: 12 },
    { name: "fig:one", file: "chapters/one.tex", line: 40 },
  ],
  citations: [
    { key: "knuth1984", author: "Knuth", year: "1984", title: "The TeXbook" },
  ],
  images: ["figures/plot.pdf"],
  texfiles: ["main.tex", "chapters/one.tex"],
  commands: [
    { name: "npistar", args: 0, file: "macros.tex", definition: "n\\pi^*" },
  ],
  environments: ["theorem"],
} as any;

function at(text: string) {
  const state = EditorState.create({ doc: text });
  const context = new CompletionContext(state, text.length, false);
  return latexSource(() => SYMBOLS)(context);
}

const labels = (text: string) =>
  (at(text)?.options ?? []).map((option) => option.label);

describe("citations", () => {
  test("inside a cite brace, the project's own keys", () => {
    expect(labels("\\cite{")).toEqual(["knuth1984"]);
  });

  test("every cite-like command counts", () => {
    for (const command of ["citep", "textcite", "footcite", "autocite"]) {
      expect(labels(`\\${command}{`)).toEqual(["knuth1984"]);
    }
  });

  test("the replacement starts at the brace, not at the backslash", () => {
    const text = "\\cite{knu";
    expect(at(text)!.from).toBe(text.length - 3);
  });

  test("a project with no bibliography offers nothing rather than an empty box", () => {
    const state = EditorState.create({ doc: "\\cite{" });
    const empty = latexSource(() => null)(new CompletionContext(state, 6, false));
    expect(empty).toBeNull();
  });
});

describe("cross-references", () => {
  test("a ref brace offers the labels in the project", () => {
    expect(labels("\\ref{")).toEqual(["eq:gap", "fig:one"]);
  });

  test("eqref, autoref and cref are all refs", () => {
    for (const command of ["eqref", "autoref", "cref", "pageref"]) {
      expect(labels(`\\${command}{`)).toContain("eq:gap");
    }
  });
});

describe("files and figures", () => {
  test("includegraphics offers the images", () => {
    expect(labels("\\includegraphics{")).toEqual(["figures/plot.pdf"]);
  });

  test("input offers tex files without their extension", () => {
    expect(labels("\\input{")).toEqual(["main", "chapters/one"]);
  });
});

describe("environments and packages", () => {
  test("begin offers the standard ones and the project's own", () => {
    expect(labels("\\begin{")).toContain("theorem");
    expect(labels("\\begin{")).toContain("equation");
  });

  test("usepackage offers packages", () => {
    expect(labels("\\usepackage{").length).toBeGreaterThan(5);
  });
});

describe("commands", () => {
  test("a backslash offers the project's own macros first", () => {
    expect(labels("\\np")).toContain("\\npistar");
  });

  test("and the standard ones", () => {
    expect(labels("\\se")).toContain("\\section");
  });

  test("a backslash at the very start of a file still completes", () => {
    expect(labels("\\")).toContain("\\section");
  });

  test("ordinary prose offers nothing", () => {
    expect(at("just some words ")).toBeNull();
  });
});

describe("staying open while a word grows", () => {
  test("a citation list says it is still valid inside its braces", () => {
    // Without this CodeMirror asks again on every keystroke and the whole
    // list is rebuilt -- four hundred objects per character on a thesis.
    expect(at("\\cite{")!.validFor).toBeDefined();
  });

  test("and a command list says the same", () => {
    expect(at("\\se")!.validFor).toBeDefined();
  });
});

/** The list is described in this file as "the floor, not the point", and
 *  that is right, but a floor with holes in it reads as a feature that does
 *  not work rather than as a deliberate shortlist. A writer reached for
 *  `\textcolor` and was offered nothing at all. */
describe("the commands the floor has to hold", () => {
  const names = new Set(COMMANDS.map(([name]) => name));

  it.each([
    // The one that was reported.
    "textcolor",
    // Its neighbours, which were missing for the same reason.
    "color", "colorbox", "definecolor",
    // Spacing, which no document avoids.
    "hspace", "vspace", "quad", "hfill", "item", "today", "newline",
    // Cross-referencing beyond the two styles that were there.
    "cref", "Cref", "citet", "parencite", "nocite",
    // Tables.
    "hline", "multicolumn", "multirow",
    // Greek letters the list simply skipped.
    "zeta", "eta", "kappa", "xi", "varepsilon", "varphi",
    "Gamma", "Lambda", "Sigma", "Phi",
    // Maths that a thesis uses on most pages.
    "pm", "equiv", "propto", "in", "ldots", "mathbb", "boldsymbol",
  ])("offers \\%s", (name) => {
    expect(names.has(name)).toBe(true);
  });

  it("still offers the ones it always did", () => {
    for (const name of ["section", "textbf", "frac", "cite", "includegraphics"]) {
      expect(names.has(name)).toBe(true);
    }
  });

  it("names no command twice", () => {
    expect(names.size).toBe(COMMANDS.length);
  });
});
