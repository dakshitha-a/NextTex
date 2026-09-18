import { describe, expect, it } from "vitest";

import { parseBlocks } from "./prose";

/** Every block knows the source line it starts on, 1-based like the
 *  editor, so a double-click on the rendering can name the line. */
describe("the source line of each block", () => {
  const SOURCE = [
    "# Title",            // 1
    "",                   // 2
    "First paragraph,",   // 3
    "two lines long.",    // 4
    "",                   // 5
    "- one",              // 6
    "- two",              // 7
    "",                   // 8
    "> quoted",           // 9
    "> still",            // 10
    "",                   // 11
    "```py",              // 12
    "x = 1",              // 13
    "```",                // 14
    "",                   // 15
    "Last.",              // 16
  ].join("\n");

  it("names the line of every kind", () => {
    const blocks = parseBlocks(SOURCE);
    expect(blocks.map((block) => [block.kind, block.line])).toEqual([
      ["heading", 1],
      ["paragraph", 3],
      ["list", 6],
      ["quote", 9],
      ["code", 12],
      ["paragraph", 16],
    ]);
  });

  it("gives each list item its own line", () => {
    const list = parseBlocks(SOURCE)[2];
    expect(list.kind).toBe("list");
    if (list.kind === "list") expect(list.lines).toEqual([6, 7]);
  });

  it("counts a code block from its opening fence", () => {
    // The text starts one line below, which the pane knows.
    const code = parseBlocks("```\nbody\n```")[0];
    expect(code.kind).toBe("code");
    expect(code.line).toBe(1);
  });

  it("counts Windows line endings as one line each", () => {
    const blocks = parseBlocks("a\r\n\r\nb\r\n\r\nc");
    expect(blocks.map((block) => block.line)).toEqual([1, 3, 5]);
  });

  it("skips runs of blank lines without losing count", () => {
    const blocks = parseBlocks("\n\n\na\n\n\n\nb");
    expect(blocks.map((block) => block.line)).toEqual([4, 8]);
  });

  it("holds the line of a fence that is never closed", () => {
    const blocks = parseBlocks("a\n\n```\nstill open");
    expect(blocks.map((block) => [block.kind, block.line])).toEqual([
      ["paragraph", 1],
      ["code", 3],
    ]);
  });

  it("moves every block below an inserted line, and only those", () => {
    const before = parseBlocks("a\n\nb\n\nc");
    const after = parseBlocks("a\n\nnew\n\nb\n\nc");
    expect(before.map((block) => block.line)).toEqual([1, 3, 5]);
    expect(after.map((block) => block.line)).toEqual([1, 3, 5, 7]);
  });
});
