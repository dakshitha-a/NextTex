import { describe, expect, it } from "vitest";
import { isEscaped } from "./escaping";

describe("isEscaped", () => {
  it("says nothing at the start of a line is escaped", () => {
    expect(isEscaped("", 0)).toBe(false);
    expect(isEscaped("abc", 3)).toBe(false);
  });

  it("sees the backslash in front of a price", () => {
    expect(isEscaped("It cost \\", 9)).toBe(true);
  });

  it("counts the run, so a line break before maths still opens it", () => {
    // `\\` is a line break in LaTeX, not an escaped backslash escaping
    // what comes next.
    expect(isEscaped("a line \\\\", 9)).toBe(false);
    expect(isEscaped("a line \\\\\\", 10)).toBe(true);
  });
});
