import { describe, expect, it } from "vitest";
import { labelFor, limitLabel, limitSpan, rangeFor, scopesFor } from "./words";
import type { Heading } from "./outline";

const outline: Heading[] = [
  { kind: "file", level: 0, title: "main.tex", line: 1, path: "main.tex" },
  { kind: "section", level: 2, title: "One", line: 10 },
  { kind: "subsection", level: 3, title: "One a", line: 20 },
  { kind: "section", level: 2, title: "Two", line: 40 },
];

describe("rangeFor", () => {
  it("gives a selection its own lines", () => {
    expect(rangeFor("selection", outline, 1, 100, { fromLine: 4, toLine: 9 }))
      .toEqual({ first: 4, last: 9 });
  });

  it("has nothing to say about a selection that is not there", () => {
    expect(rangeFor("selection", outline, 1, 100, null)).toBeNull();
  });

  it("runs a section to the heading after it", () => {
    expect(rangeFor("section", outline, 12, 100, null)).toEqual({ first: 10, last: 19 });
  });

  it("counts the subsection the cursor is actually in", () => {
    expect(rangeFor("section", outline, 25, 100, null)).toEqual({ first: 20, last: 39 });
  });

  it("runs the last section to the end of the file", () => {
    expect(rangeFor("section", outline, 50, 100, null)).toEqual({ first: 40, last: 100 });
  });

  it("has nothing to say above the first heading", () => {
    // The preamble. A cursor there is in no section, and counting the
    // whole file instead would be a different number under the same word.
    expect(rangeFor("section", outline, 3, 100, null)).toBeNull();
  });

  it("ignores the file rows, which are not sections", () => {
    const only: Heading[] = [
      { kind: "file", level: 0, title: "main.tex", line: 1, path: "main.tex" },
    ];
    expect(rangeFor("section", only, 5, 100, null)).toBeNull();
  });

  it("says nothing for the whole-file scopes", () => {
    expect(rangeFor("file", outline, 12, 100, null)).toBeNull();
    expect(rangeFor("document", outline, 12, 100, null)).toBeNull();
  });
});

describe("scopesFor", () => {
  it("offers a selection only when there is one", () => {
    expect(scopesFor(false)).not.toContain("selection");
    expect(scopesFor(true)).toContain("selection");
  });
});

describe("labelFor", () => {
  it("says what it counted, not just how many", () => {
    expect(labelFor("document", 12345)).toBe("12,345 words");
    expect(labelFor("section", 210)).toBe("210 in section");
  });
});

describe("limitSpan", () => {
  const paper: Heading[] = [
    { kind: "abstract", level: 2, title: "Abstract", line: 5, end: 9 },
    { kind: "section", level: 2, title: "One", line: 12 },
    { kind: "subsection", level: 3, title: "One a", line: 20 },
    { kind: "file", level: 1, title: "table", line: 25, path: "table.tex" },
    { kind: "section", level: 2, title: "Two", line: 40 },
  ];

  it("counts an abstract between its begin and end", () => {
    expect(limitSpan(paper, 0, 100)).toEqual({ first: 5, last: 9 });
  });

  it("counts a section's subsections towards it, past an included file", () => {
    expect(limitSpan(paper, 1, 100)).toEqual({ first: 12, last: 39 });
  });

  it("ends a subsection at the next heading at its level or above", () => {
    expect(limitSpan(paper, 2, 100)).toEqual({ first: 20, last: 39 });
  });

  it("runs the last section to the end of the file", () => {
    expect(limitSpan(paper, 4, 100)).toEqual({ first: 40, last: 100 });
  });

  it("puts the title block after an abstract in no section", () => {
    expect(rangeFor("section", paper, 7, 100, null)).toEqual({ first: 5, last: 9 });
    expect(rangeFor("section", paper, 10, 100, null)).toBeNull();
  });
});

describe("limitLabel", () => {
  it("says the count against the limit, and a dash before one arrives", () => {
    expect(limitLabel(212, 250)).toBe("212 of 250");
    expect(limitLabel(1240, 1200)).toBe("1,240 of 1,200");
    expect(limitLabel(null, 250)).toBe("\u2013 of 250");
  });
});
