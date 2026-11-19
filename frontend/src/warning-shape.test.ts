import { describe, expect, it } from "vitest";
import { hiddenBy, hiddenOf, warningShape } from "./warning-shape";

describe("hidden warnings", () => {
  it("hides a warning's kind, numbers and all, as the server does", () => {
    const shape = warningShape("Overfull \\hbox (3.2pt too wide) in paragraph at lines 12--14");
    expect(shape).toBe("Overfull \\hbox (#pt too wide) in paragraph at lines #--#");
    expect(hiddenBy("Overfull \\hbox (17.04pt too wide) in paragraph at lines 80--81", [shape])).toBe(true);
    expect(hiddenBy("Underfull \\hbox (badness 10000) in paragraph at lines 1--2", [shape])).toBe(false);
    expect(hiddenBy("Package hyperref Warning: Suppressing link with empty target on input line 55.",
      ["Suppressing link with empty target"])).toBe(true);
  });

  it("reads only a table of documents to lists of words", () => {
    expect(hiddenOf({ "main.tex": ["a", 3, ""], "x.tex": "no", "y.tex": [] })).toEqual({ "main.tex": ["a"] });
    expect(hiddenOf(null)).toEqual({});
    expect(hiddenOf(["main.tex"])).toEqual({});
  });
});
