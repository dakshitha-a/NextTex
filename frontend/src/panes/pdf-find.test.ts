import { describe, expect, it } from "vitest";
import { findIn, spanFor, textOf } from "./pdf-find";

describe("textOf", () => {
  it("joins items with nothing between, and a newline after a line end", () => {
    expect(
      textOf([{ str: "re" }, { str: "sults", hasEOL: true }, { str: "next" }]),
    ).toBe("results\nnext");
  });
});

describe("findIn", () => {
  const pages = ["The results are in.", "No mention here.", "Results, results."];

  it("reports the page a hit is on, 1-based", () => {
    expect(findIn(pages, "results").map((hit) => hit.page)).toEqual([1, 3, 3]);
  });

  it("ignores case, the way the other two finds do", () => {
    expect(findIn(pages, "RESULTS")).toHaveLength(3);
  });

  it("numbers the hits within a page", () => {
    const third = findIn(pages, "results");
    expect(third.map((hit) => hit.occurrence)).toEqual([0, 0, 1]);
  });

  it("finds nothing for nothing", () => {
    expect(findIn(pages, "   ")).toEqual([]);
    expect(findIn(pages, "absent")).toEqual([]);
  });
});

describe("spanFor", () => {
  const spans = [
    { textContent: "The results" },
    { textContent: "are results, results" },
    { textContent: "done" },
  ];

  it("walks to the nth span holding the query", () => {
    expect(spanFor(spans, "results", 0)).toBe(spans[0]);
    expect(spanFor(spans, "results", 1)).toBe(spans[1]);
    expect(spanFor(spans, "results", 2)).toBe(spans[1]);
    expect(spanFor(spans, "results", 3)).toBeNull();
  });
});
