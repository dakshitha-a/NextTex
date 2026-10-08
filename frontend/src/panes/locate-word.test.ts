import { describe, expect, it } from "vitest";
import { agreement, foldText, locateWord, normaliseWord, project, type WordHint } from "./locate-word";

/** A double-click, written as the page reads with the clicked word in
 *  brackets: "the model [predicts] the state". */
function click(page: string, extra: Partial<WordHint> = {}): WordHint {
  const open = page.indexOf("[");
  const close = page.indexOf("]", open);
  return {
    word: page.slice(open + 1, close),
    before: page.slice(0, open),
    after: page.slice(close + 1),
    ...extra,
  };
}

/** Where a click lands in `source`, given the line synctex named, as the
 *  selected text and its line. */
function land(source: string[], near: number, hint: WordHint | string, radius?: number) {
  const found = locateWord((line) => source[line - 1] ?? "", source.length, near, hint, radius);
  if (!found) return null;
  return { line: found.line, text: source[found.line - 1].slice(found.from, found.to), from: found.from };
}

describe("project", () => {
  it("keeps what TeX sets and drops commands, keys and comments", () => {
    expect(project("See~\\ref{sec:a} and \\cite{knuth} % note").text).toBe("seeand");
    expect(project("\\textcolor{red}{important} words").text).toBe("importantwords");
    expect(project("\\section{Results}\\label{sec:results}").text).toBe("results");
  });

  it("maps every letter back to the column that set it", () => {
    const line = "a \\textbf{wo}rd";
    const { text, from, to } = project(line);
    expect(text).toBe("aword");
    expect(line.slice(from[1], to[4])).toBe("wo}rd");
  });

  it("reads an accent macro as the letter it sets, covering the macro", () => {
    const line = "Schr\\\"odinger, caf\\'{e}, na\\\"\\i ve, \\v{c}";
    const { text, from, to } = project(line);
    expect(text).toBe("schrodingercafenaivec");
    expect(line.slice(from[4], to[4])).toBe("\\\"o");
  });

  it("sets maths as its glyphs: S_0 is s0, \\alpha_i is αi", () => {
    expect(project("$S_0$ and $\\alpha_i x^2$").text).toBe("s0andαix2");
  });

  it("does not take a table's column specification or a float's placement for text", () => {
    expect(project("\\begin{tabular}{@{}lrr@{}}").text).toBe("");
    expect(project("\\begin{figure}[h!]").text).toBe("");
  });

  it("keeps a theorem's title and a citation's notes, which are typeset", () => {
    expect(project("\\begin{theorem}[Main result]").text).toBe("mainresult");
    expect(project("Jones~\\cite[p.~4]{jones2019} found").text).toBe("jonesp4found");
  });

  it("reads plain prose whole, but not a link's address", () => {
    expect(project("About 50% of [users](http://x.org) read", true).text).toBe("about50ofusersread");
  });
});

describe("foldText", () => {
  it("lowers case, drops accents, expands ligatures and sets dotless i as i", () => {
    expect(foldText("Eﬃcient Schr¨odinger café na¨ıve")).toBe("efficientschrodingercafenaive");
  });
});

describe("agreement", () => {
  it("counts what agrees, and skips past a little that does not", () => {
    expect(agreement("abcdef", "abcdef", 60)).toBe(6);
    // A section number on the page that the source does not have.
    expect(agreement("1introduction", "introduction", 60)).toBe(11);
    expect(agreement("abc", "xyz", 60)).toBe(0);
  });
});

describe("locateWord", () => {
  const PARAGRAPH = [
    "\\section{Introduction}",
    "",
    "The model predicts the state, and the model then corrects the state using the model of the noise.",
  ];

  it("lands on the occurrence that was clicked, not the first one in the paragraph", () => {
    // The paragraph is one line, so the line alone is the whole paragraph.
    const third = land(PARAGRAPH, 3, click("then corrects the state using the [model] of the noise."))!;
    expect(third).toEqual({ line: 3, text: "model", from: PARAGRAPH[2].lastIndexOf("model") });
    const second = land(PARAGRAPH, 3, click("predicts the state, and the [model] then corrects"))!;
    expect(second.from).toBe(PARAGRAPH[2].indexOf("model then"));
  });

  it("finds a single letter and a short word by what is around them", () => {
    const source = ["We take a sample and a control, then a third."];
    const found = land(source, 1, click("and a control, then [a] third."))!;
    expect(found.from).toBe(source[0].lastIndexOf(" a ") + 1);
  });

  it("finds maths the page sets as S0, αi and mc2", () => {
    const source = ["The ground state $S_0$ and the energy $E = mc^2$ with $\\alpha_i$ terms."];
    expect(land(source, 1, click("The ground state [S0] and the energy"))?.text).toBe("S_0");
    expect(land(source, 1, click("and the energy E = [mc2] with αi"))?.text).toBe("mc^2");
    expect(land(source, 1, click("E = mc2 with [αi] terms."))?.text).toBe("\\alpha_i");
  });

  it("never lands in a command or its key", () => {
    const source = ["Some \\textcolor{red}{important content} and a red word, \\left( x \\right) left alone."];
    expect(land(source, 1, click("content and a [red] word,"))?.from).toBe(source[0].indexOf("red word"));
    expect(land(source, 1, click("( x ) [left] alone."))?.from).toBe(source[0].indexOf("left alone"));
  });

  it("finds a heading's word in the heading, not in the paragraph under it", () => {
    const source = ["\\section{Results}", "\\label{sec:results}", "Results show that the results hold."];
    // synctex names the paragraph for the lower half of a heading.
    expect(land(source, 3, click("[Results] Results show that"))).toEqual({ line: 1, text: "Results", from: 9 });
    expect(land(source, 3, click("Results [Results] show that"))?.line).toBe(3);
  });

  it("selects the whole word when the page split it at an accent or a line end", () => {
    const source = ["Schr\\\"odinger wrote it; misrepresentations followed."];
    expect(land(source, 1, click("[Schr¨odinger] wrote it;"))?.text).toBe("Schr\\\"odinger");
    expect(land(source, 1, click("wrote it; [misrep-\nresentations] followed."))?.text).toBe("misrepresentations");
  });

  it("selects the command that made a word the source does not have", () => {
    const source = [
      "Before the section.",
      "\\section{Methods}",
      "The method\\footnote{See the appendix.} works, as Figure~\\ref{fig:a} shows.",
      "\\begin{figure}[h]",
      "  \\centering",
      "  \\caption{A schematic.}",
      "\\end{figure}",
      "\\begin{enumerate}",
      "  \\item Cutting.",
      "\\end{enumerate}",
    ];
    expect(land(source, 2, click("Before the section. [2] Methods The method"))?.text).toBe("\\section");
    expect(land(source, 3, click("Methods The [method1] works, as"))?.text).toBe("method");
    expect(land(source, 3, click("works, as Figure [1] shows."))?.text).toBe("\\ref");
    expect(land(source, 6, click("shows. [Figure] 1: A schematic."))?.text).toBe("\\caption");
    expect(land(source, 9, click("A schematic. [1]. Cutting."))?.text).toBe("\\item");
  });

  it("takes an environment's name with it", () => {
    const source = ["Text before.", "\\begin{theorem}", "Every bounded sequence converges."];
    expect(land(source, 2, click("Text before. [Theorem] 1. Every bounded"))?.text).toBe("\\begin{theorem}");
  });

  it("reads a paragraph wrapped by hand as the one paragraph it is", () => {
    const source = [
      "the word appears here,",
      "and the word",
      "appears here again.",
    ];
    expect(land(source, 2, click("appears here, and the word [appears] here again."))).toEqual({ line: 3, text: "appears", from: 0 });
  });

  it("finds a paragraph that moved further than the window since the build", () => {
    const source = [
      ...Array.from({ length: 100 }, (_, i) => `Filler paragraph ${i} about something else.`),
      "The model predicts the state of the system.",
    ];
    expect(land(source, 1, click("The model predicts [the] state of the system."))).toEqual({
      line: 101, text: "the", from: source[100].indexOf("the state"),
    });
  });

  it("is never confident about a page number", () => {
    const source = ["The last words on the page."];
    expect(land(source, 1, click("last words on the page. [12]"))).toBeNull();
  });

  it("gives up rather than guessing when nothing agrees", () => {
    const source = ["Nothing here is like the page."];
    expect(land(source, 1, click("[zebra]"))).toBeNull();
    expect(land(source, 1, { word: "" })).toBeNull();
  });

  it("does not match inside a comment or a key", () => {
    const source = ["Results are shown. % results again", "\\label{sec:again}"];
    expect(land(source, 1, click("[again]"))).toBeNull();
  });

  it("clamps a line the file no longer has", () => {
    const source = ["An efficient method."];
    expect(land(source, 999, click("An [efficient] method."))?.text).toBe("efficient");
  });

  it("keeps the words after a percent sign in plain prose", () => {
    const source = ["# Findings", "", "About 50% of users read on, and 50% do not."];
    expect(land(source, 3, click("About 50% of [users] read on", { plain: true }))?.text).toBe("users");
    expect(land(source, 3, click("About 50% of [users] read on"))).toBeNull();
  });

  it("accepts a bare word, as the Markdown pane once sent", () => {
    expect(land(["An efficient method."], 1, "efficient")?.text).toBe("efficient");
  });
});

describe("normaliseWord", () => {
  it("undoes ligatures and drops attached punctuation", () => {
    expect(normaliseWord("eﬃcient,")).toBe("efficient");
    expect(normaliseWord("“quoted”")).toBe("quoted");
    expect(normaliseWord("a")).toBe("");
  });
});
