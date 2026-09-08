import { describe, expect, it } from "vitest";
import { locateWord, normaliseWord } from "./locate-word";

const SOURCE = [
  "\\section{Writing}",                                          // 1
  "",                                                            // 2
  "Text goes here. A citation looks like this~\\cite{knuth1984},", // 3
  "and a cross-reference to Section~\\ref{sec:maths} looks like",  // 4
  "that. The theory of the thing is not the thing.",              // 5
  "",                                                            // 6
  "An efficient method, and a second efficient one.",             // 7
];

const read = (line: number) => SOURCE[line - 1] ?? "";
const near = (line: number, word: string, radius?: number) =>
  locateWord(read, SOURCE.length, line, word, radius);

describe("normaliseWord", () => {
  it("undoes the ligatures a PDF sets as one glyph", () => {
    expect(normaliseWord("eﬃcient")).toBe("efficient");
    expect(normaliseWord("ﬁgure")).toBe("figure");
  });

  it("drops the punctuation the typesetter attached", () => {
    expect(normaliseWord("this~")).toBe("this");
    expect(normaliseWord("(citation),")).toBe("citation");
    expect(normaliseWord("“quoted”")).toBe("quoted");
  });

  it("refuses anything too short to be worth trusting", () => {
    // A one-character match would move the cursor confidently to the wrong
    // place, which is worse than not moving it at all.
    expect(normaliseWord("a")).toBe("");
    expect(normaliseWord(".")).toBe("");
    expect(normaliseWord("42")).toBe("");
    expect(normaliseWord("   ")).toBe("");
  });
});

describe("locateWord", () => {
  it("finds the word on the line synctex named", () => {
    expect(near(3, "citation")).toEqual({ line: 3, column: 19 });
  });

  it("is 1-based in both directions, like synctex and CodeMirror", () => {
    const at = near(1, "section")!;
    expect(read(at.line).slice(at.column - 1, at.column + 6)).toBe("section");
  });

  it("searches outwards when the line is a little out", () => {
    // The whole point: synctex is approximate around macros and floats, and
    // a jump that is three lines off still lands on the right words.
    expect(near(2, "cross-reference")?.line).toBe(4);
    expect(near(7, "theory")?.line).toBe(5);
  });

  it("prefers the named line over a nearer word elsewhere", () => {
    // "the" is on line 5 twice and nowhere else; asked about line 5 it must
    // take the first one on that line rather than wandering.
    // "The", capitalised, at column 7 -- matching is case-insensitive
    // because the page may set small caps or a title case the source does
    // not have.
    expect(near(5, "the")).toEqual({ line: 5, column: 7 });
  });

  it("takes the first occurrence on a line, left to right", () => {
    expect(near(7, "efficient")).toEqual({ line: 7, column: 4 });
  });

  it("does not match inside a longer word", () => {
    // "the" must not land in "theory", which is the failure that makes a
    // jump land somewhere baffling.
    const found = near(5, "the")!;
    expect(read(found.line).slice(found.column - 1, found.column + 2).toLowerCase())
      .toBe("the");
    expect(read(found.line)[found.column + 2]).toBe(" ");
  });

  it("gives up rather than guessing", () => {
    // A word the source spells with a macro -- \LaTeX, a \ref that set as
    // "2" -- simply is not there, and the caller falls back to the line.
    expect(near(3, "notinthisdocument")).toBeNull();
    expect(near(3, "a")).toBeNull();
  });

  it("stays inside the document", () => {
    expect(near(1, "thing")?.line).toBe(5);
    // A line the file no longer has, because the PDF is older than the
    // source. Clamped to the end and searched from there rather than
    // scanning a range entirely off the document.
    expect(locateWord(read, SOURCE.length, 999, "efficient")).toEqual({
      line: 7,
      column: 4,
    });
  });

  it("honours the radius, so a huge file is not scanned twice over", () => {
    expect(near(1, "efficient", 2)).toBeNull();
    expect(near(1, "efficient", 6)?.line).toBe(7);
  });
});
