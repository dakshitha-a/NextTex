import { describe, expect, it } from "vitest";

import { lineOf, sameWithLines } from "./markdown-source";
import { parseBlocks, same, type Block } from "./prose";

const wrap = (block: Block) => ({ block });

describe("the line a double-clicked word is on", () => {
  const paragraph = parseBlocks(
    ["Intro.", "", "First line of prose,", "second line here,", "and a third."].join("\n"),
  )[1];

  it("finds the word on the block's third line", () => {
    expect(paragraph.line).toBe(3);
    expect(lineOf(paragraph, "third")).toBe(5);
  });

  it("finds a word the rendering set in bold, since the source still has it", () => {
    const block = parseBlocks("Some **weight** here,\nand more.")[0];
    expect(lineOf(block, "weight")).toBe(1);
    expect(lineOf(block, "more")).toBe(2);
  });

  it("falls back to the block's first line for a word it does not have", () => {
    expect(lineOf(paragraph, "elsewhere")).toBe(3);
    // Punctuation and a single letter are no word at all.
    expect(lineOf(paragraph, ",")).toBe(3);
  });

  it("starts a code block's text one line under its fence", () => {
    const code = parseBlocks("```py\nfirst = 1\nsecond = 2\n```")[0];
    expect(lineOf(code, "second")).toBe(3);
    expect(lineOf(code, "nothing")).toBe(2);
  });

  it("matches a whole word, not the inside of a longer one", () => {
    const block = parseBlocks("theory first,\nthe second.")[0];
    expect(lineOf(block, "the")).toBe(2);
  });

  it("leaves a list to its items", () => {
    const list = parseBlocks("- one\n- two")[0];
    // The caller reads the item's own line off its element.
    expect(lineOf(list, "two")).toBe(1);
  });
});

describe("skipping a block that did not change, lines included", () => {
  it("agrees with same when nothing moved", () => {
    const [before] = parseBlocks("A paragraph.");
    const [after] = parseBlocks("A paragraph.");
    expect(same(wrap(before), wrap(after))).toBe(true);
    expect(sameWithLines(wrap(before), wrap(after))).toBe(true);
  });

  it("redraws a block whose text is the same but which moved down", () => {
    // The chat's comparison says these are the same, on purpose; the pane
    // writes the line into the DOM and has to say otherwise.
    const before = parseBlocks("a\n\nb")[1];
    const after = parseBlocks("a\n\nnew\n\nb")[2];
    expect(same(wrap(before), wrap(after))).toBe(true);
    expect(sameWithLines(wrap(before), wrap(after))).toBe(false);
  });

  it("notices a list whose items kept their text but not their lines", () => {
    const before = parseBlocks("- one\n- two")[0];
    const after = parseBlocks("- one\n\n- two")[1];
    if (before.kind !== "list" || after.kind !== "list") throw new Error("not lists");
    // The second is a new list starting at line 3 with one item; compare
    // a list that kept its start but not its second item's line instead.
    const moved: Block = { ...before, lines: [1, 3] };
    expect(sameWithLines(wrap(before), wrap(moved))).toBe(false);
    expect(after.line).toBe(3);
  });
});
