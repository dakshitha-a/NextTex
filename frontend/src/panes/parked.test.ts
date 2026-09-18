import { describe, expect, test } from "vitest";
import { EditorState, EditorSelection } from "@codemirror/state";
import { changeBetween, reconciled } from "./parked";

describe("the smallest change between two texts", () => {
  test("nothing when they agree", () => {
    expect(changeBetween("abc", "abc")).toBeNull();
  });

  test("a word replaced in the middle touches only the word", () => {
    expect(changeBetween("Everything below is here", "Everything below is there"))
      .toEqual({ from: 20, to: 20, insert: "t" });
  });

  test("a whole rewrite is one replacement", () => {
    expect(changeBetween("old text", "new words")).toEqual({ from: 0, to: 8, insert: "new words" });
  });

  test("an insertion at the end, and a deletion at the start", () => {
    expect(changeBetween("ab", "abc")).toEqual({ from: 2, to: 2, insert: "c" });
    expect(changeBetween("xab", "ab")).toEqual({ from: 0, to: 1, insert: "" });
  });

  test("a repeated tail is not matched twice", () => {
    // "aa" -> "a": prefix stops at 1, and the suffix must not also claim
    // the same character, or the change would have from > to.
    expect(changeBetween("aa", "a")).toEqual({ from: 1, to: 2, insert: "" });
    expect(changeBetween("a", "aa")).toEqual({ from: 1, to: 1, insert: "a" });
  });
});

describe("a parked state brought back into step", () => {
  test("the text moves and the caret moves with it", () => {
    const state = EditorState.create({
      doc: "one\ntwo\nthree\n",
      selection: EditorSelection.single(9),   // on "three"
    });
    const next = reconciled(state, "one\ntwo and a half\nthree\n");
    expect(next.doc.toString()).toBe("one\ntwo and a half\nthree\n");
    expect(next.selection.main.head).toBe(20);
  });

  test("the same state comes back when nothing moved", () => {
    const state = EditorState.create({ doc: "same\n" });
    expect(reconciled(state, "same\n")).toBe(state);
  });
});
