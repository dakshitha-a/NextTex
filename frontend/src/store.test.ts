import { describe, expect, test } from "vitest";
import { countDiff, firstChangedLine } from "./store";

/** Reading a diff, which the chat panel does for every edit Claude makes.
 *
 *  Both of these are silent when wrong: a caret that lands on the wrong
 *  line, or a chip that says +3/−3 for a paragraph that moved.
 */

describe("where an edit begins", () => {
  test("identical text has no first changed line", () => {
    expect(firstChangedLine("a\nb\nc", "a\nb\nc")).toBe(1);
  });

  test("a change on the first line is line one", () => {
    expect(firstChangedLine("a\nb", "A\nb")).toBe(1);
  });

  test("a change in the middle is found", () => {
    expect(firstChangedLine("a\nb\nc", "a\nB\nc")).toBe(2);
  });

  test("an append points at the first new line", () => {
    expect(firstChangedLine("a\nb", "a\nb\nc")).toBe(3);
  });

  test("a deletion points at where the text used to be", () => {
    expect(firstChangedLine("a\nb\nc", "a\nc")).toBe(2);
  });

  test("writing into an empty file is line one", () => {
    expect(firstChangedLine("", "the first sentence")).toBe(1);
  });
});

describe("how much changed", () => {
  test("an added line counts once", () => {
    expect(countDiff("a\nb", "a\nnew\nb")).toEqual({ added: 1, removed: 0 });
  });

  test("a removed line counts once", () => {
    expect(countDiff("a\nb\nc", "a\nc")).toEqual({ added: 0, removed: 1 });
  });

  test("a rewritten line is one of each", () => {
    expect(countDiff("a\nb", "a\nB")).toEqual({ added: 1, removed: 1 });
  });

  test("no change is nothing", () => {
    expect(countDiff("a\nb", "a\nb")).toEqual({ added: 0, removed: 0 });
  });

  test("a line that only moved is not counted twice", () => {
    // LaTeX repeats lines constantly -- \centering, \hline, blank lines --
    // and a naive line-by-line count reports a moved one as +1 and −1.
    const before = "\\begin{figure}\n\\centering\n\\caption{One}\n\\end{figure}";
    const after = "\\begin{figure}\n\\caption{One}\n\\centering\n\\end{figure}";
    const { added, removed } = countDiff(before, after);
    expect(added).toBeLessThanOrEqual(1);
    expect(removed).toBeLessThanOrEqual(1);
  });
});
