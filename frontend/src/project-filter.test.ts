import { describe, expect, it } from "vitest";

import { LONG_LIST, matches } from "./project-filter";

const thesis = { name: "thesis", path: "/home/d/writing/Thesis-2027" };

describe("the project filter", () => {
  it("matches nothing typed to everything", () => {
    expect(matches(thesis, "")).toBe(true);
    expect(matches(thesis, "   ")).toBe(true);
  });

  it("matches a word in the name or the path, case regardless", () => {
    expect(matches(thesis, "THE")).toBe(true);
    expect(matches(thesis, "writing")).toBe(true);
    expect(matches(thesis, "poster")).toBe(false);
  });

  it("wants every word, wherever each one lands", () => {
    expect(matches(thesis, "thesis 2027")).toBe(true);
    expect(matches(thesis, "thesis 2026")).toBe(false);
  });

  it("calls six a long list", () => {
    expect(LONG_LIST).toBe(6);
  });
});
