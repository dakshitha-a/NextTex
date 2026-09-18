import { describe, expect, it } from "vitest";
import type { Heading } from "./outline";
import { sectionAtTop, trailTo } from "./section-at-top";

const h = (kind: Heading["kind"], level: number, title: string, line: number, path?: string): Heading =>
  ({ kind, level, title, line, ...(path ? { path } : {}) }) as Heading;

const headings: Heading[] = [
  h("chapter", 1, "Method", 3),
  h("section", 2, "Sampling", 10),
  h("subsection", 3, "Frames", 20),
  h("section", 2, "Analysis", 40),
  h("file", 1, "appendix", 60, "appendix.tex"),
];

describe("the section at the top of the pane", () => {
  it("names the section the top line is in", () => {
    expect(sectionAtTop(headings, 15)?.title).toBe("Sampling");
    expect(sectionAtTop(headings, 25)?.title).toBe("Frames");
    expect(sectionAtTop(headings, 45)?.title).toBe("Analysis");
  });

  it("hides before the first heading, on a heading's own line, and in a file with none", () => {
    expect(sectionAtTop(headings, 1)).toBeNull();
    expect(sectionAtTop(headings, 10)).toBeNull();
    expect(sectionAtTop([], 5)).toBeNull();
  });

  it("an include in a skeleton is not a place the reader is inside", () => {
    // Past the include, the last real heading still answers.
    expect(sectionAtTop(headings, 70)?.title).toBe("Analysis");
  });
});

describe("the trail above a heading", () => {
  it("runs from the outermost enclosing heading down", () => {
    expect(trailTo(headings, headings[2]).map((x) => x.title)).toEqual(["Method", "Sampling", "Frames"]);
    expect(trailTo(headings, headings[3]).map((x) => x.title)).toEqual(["Method", "Analysis"]);
    expect(trailTo(headings, headings[0]).map((x) => x.title)).toEqual(["Method"]);
  });
});
