import { describe, expect, it } from "vitest";
import { clean, contextOf, headingAt, outline } from "./outline";

describe("outline", () => {
  it("reads the sectioning commands in order, with their lines", () => {
    const found = outline(
      [
        "\\chapter{THEORY}",
        "Some prose.",
        "\\section{Electronic structure}",
        "\\subsection{CASSCF}",
      ].join("\n"),
    );
    expect(found.map((h) => [h.kind, h.title, h.line])).toEqual([
      ["chapter", "THEORY", 1],
      ["section", "Electronic structure", 3],
      ["subsection", "CASSCF", 4],
    ]);
  });

  it("nests by the depth LaTeX itself gives each command", () => {
    const found = outline("\\part{A}\n\\chapter{B}\n\\section{C}\n\\subsubsection{D}");
    expect(found.map((h) => h.level)).toEqual([0, 1, 2, 4]);
  });

  it("lists the abstract at the level of the file's top headings, with its end", () => {
    const found = outline(
      [
        "\\begin{document}",
        "\\begin{abstract}",
        "What we found.",
        "\\end{abstract}",
        "\\section{Introduction}",
      ].join("\n"),
    );
    expect(found).toEqual([
      { kind: "abstract", level: 2, title: "Abstract", line: 2, end: 4 },
      { kind: "section", level: 2, title: "Introduction", line: 5 },
    ]);
    // In a book the abstract sits beside the chapters, not under them.
    expect(outline("\\begin{abstract}x\\end{abstract}\n\\chapter{One}")[0].level).toBe(1);
  });

  it("keeps starred headings, which are places even when unnumbered", () => {
    const found = outline("\\section*{Acknowledgments}");
    expect(found).toEqual([
      { kind: "section", level: 2, title: "Acknowledgments", line: 1 },
    ]);
  });

  it("skips a heading that has been commented out", () => {
    const found = outline("% \\section{Not yet}\n\\section{Real}");
    expect(found.map((h) => h.title)).toEqual(["Real"]);
  });

  it("does not mistake an escaped percent for a comment", () => {
    const found = outline("\\section{Yield of 40\\% or more}");
    expect(found[0].title).toBe("Yield of 40% or more");
  });

  it("ignores anything inside a verbatim block", () => {
    const found = outline(
      "\\begin{verbatim}\n\\section{Example}\n\\end{verbatim}\n\\section{After}",
    );
    expect(found.map((h) => [h.title, h.line])).toEqual([["After", 4]]);
  });

  it("follows a title across a line break and reports where it began", () => {
    const found = outline("intro\n\\section{A rather long\n  title}\n\\section{Next}");
    expect(found.map((h) => [h.title, h.line])).toEqual([
      ["A rather long title", 2],
      ["Next", 4],
    ]);
  });

  it("reads an optional short title without swallowing the real one", () => {
    const found = outline("\\chapter[Short]{The long one}");
    expect(found[0].title).toBe("The long one");
  });

  it("lists included files, which are the outline of a skeleton document", () => {
    const found = outline(
      "\\include{chapters/02_theory/02_theory}\n\\input{frontmatter/abstract.tex}",
    );
    expect(found).toEqual([
      {
        kind: "file",
        level: 1,
        title: "02_theory",
        line: 1,
        path: "chapters/02_theory/02_theory.tex",
      },
      {
        kind: "file",
        level: 1,
        title: "abstract",
        line: 2,
        path: "frontmatter/abstract.tex",
      },
    ]);
  });

  it("puts an included file inside the heading it follows, not at a chapter's level", () => {
    const found = outline(
      [
        "\\input{sections/intro}",
        "\\subsection{Which surface}",
        "\\subsubsection{The search}",
        "\\input{sections/table_s0t1}",
        "\\subsubsection{What this means}",
      ].join("\n"),
    );
    expect(found.map((h) => [h.title, h.level])).toEqual([
      ["intro", 3],
      ["Which surface", 3],
      ["The search", 4],
      ["table_s0t1", 5],
      ["What this means", 4],
    ]);
  });

  it("leaves the preamble out: a loaded macro file is not a chapter", () => {
    const found = outline(
      [
        "\\input{preamble/macros}",
        "\\begin{document}",
        "\\include{chapters/one}",
        "\\end{document}",
      ].join("\n"),
    );
    expect(found.map((h) => h.title)).toEqual(["one"]);
  });

  it("keeps the inputs of a file that never begins a document", () => {
    // A chapter is included into something else, so it has no preamble to
    // separate -- everything it pulls in is part of its outline.
    const found = outline("\\section{Method}\n\\input{tables/energies}");
    expect(found.map((h) => h.title)).toEqual(["Method", "energies"]);
  });

  it("survives a heading whose brace is never closed", () => {
    expect(outline("\\section{unfinished")).toEqual([]);
  });

  it("gives an empty title a name rather than a blank row", () => {
    expect(outline("\\section{}")[0].title).toBe("(untitled)");
  });
});

describe("clean", () => {
  it("keeps the words inside formatting commands", () => {
    expect(clean("The \\textit{cis} isomer")).toBe("The cis isomer");
  });

  it("unwraps a command nested inside another", () => {
    expect(clean("\\textbf{\\emph{Both}}")).toBe("Both");
  });

  it("drops a label without dropping the title around it", () => {
    expect(clean("Dynamics\\label{sec:dyn}")).toBe("Dynamics");
  });

  it("keeps a bare macro's name, since it stands for a word", () => {
    expect(clean("\\ONP{} photodissociation")).toBe("ONP photodissociation");
  });

  it("shows LaTeX dashes the way they are typeset", () => {
    expect(clean("Born--Oppenheimer")).toBe("Born\u2013Oppenheimer");
    expect(clean("A thought --- an aside")).toBe("A thought \u2014 an aside");
  });

  it("collapses the whitespace a line break leaves behind", () => {
    expect(clean("One \\\\ two")).toBe("One two");
  });
});

describe("headingAt", () => {
  const headings = outline("\\section{A}\nx\nx\n\\section{B}\nx");

  it("finds the heading the caret is sitting under", () => {
    expect(headingAt(headings, 2)).toBe(0);
    expect(headingAt(headings, 5)).toBe(1);
  });

  it("counts a heading's own line as inside it", () => {
    expect(headingAt(headings, 4)).toBe(1);
  });

  it("reports nothing above the first heading, which is a real place", () => {
    expect(headingAt(outline("x\n\\section{A}"), 1)).toBe(-1);
  });
});

describe("outline with the project's commands", () => {
  const context = contextOf([
    { name: "Sz", args: 0, definition: "\\ensuremath{\\mathrm{S_0}}" },
    { name: "figdir", args: 0, definition: "figures" },
    { name: "backmatter", args: 1, definition: "%\n  \\section*{#1}\\addcontentsline{toc}{section}{#1}" },
    { name: "two", args: 2, definition: "#1#2" },
  ]);

  it("writes the project's macros out in a title", () => {
    expect(outline("\\section{The \\Sz{} minimum}", context)[0].title).toBe("The S₀ minimum");
  });

  it("lists a heading the project's own command makes", () => {
    const found = outline("\\section{Conclusions}\n\\backmatter{Data availability}", context);
    expect(found.map((h) => [h.kind, h.title, h.line])).toEqual([
      ["section", "Conclusions", 1],
      ["section", "Data availability", 2],
    ]);
  });

  it("follows an input whose folder is a macro", () => {
    const [file] = outline("\\input{\\figdir/pipeline}", context);
    expect(file.path).toBe("figures/pipeline.tex");
  });

  it("leaves out a heading inside a definition in the preamble", () => {
    const found = outline("\\newcommand{\\back}[1]{\\section*{#1}}\n\\begin{document}\n\\section{Real}", context);
    expect(found.map((h) => h.title)).toEqual(["Real"]);
  });
});

describe("clean with maths", () => {
  it("sets subscripts, superscripts and Greek as the page does", () => {
    expect(clean("Which surface carries the NH + CH$_4$ channel?")).toBe("Which surface carries the NH + CH₄ channel?");
    expect(clean("What this means for the $\\mathrm{NH}(X\\,^3\\Sigma^-)$ signal")).toBe("What this means for the NH(X³Σ⁻) signal");
    expect(clean("at $6.17 \\pm 0.09$~eV and 1~cm$^{-1}$")).toBe("at 6.17 ± 0.09 eV and 1 cm⁻¹");
  });

  it("gives a texorpdfstring's TeX form once", () => {
    expect(clean("\\texorpdfstring{Population Dynamics with $\\omega$B97XD.}{Population Dynamics with wB97XD.}"))
      .toBe("Population Dynamics with ωB97XD.");
  });

  it("drops a switch of face and keeps what it sets", () => {
    expect(clean("along ({\\bf g}) and \\emph{h}")).toBe("along (g) and h");
  });

  it("keeps a dollar sign that is not maths", () => {
    expect(clean("Costs in \\$ and more")).toBe("Costs in $ and more");
  });
});
