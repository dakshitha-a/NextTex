import { describe, expect, it } from "vitest";
import { labelFor, rangeFor, scopesFor } from "./words";
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
