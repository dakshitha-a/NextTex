import { describe, expect, it } from "vitest";

import { parseBlocks, same, type Block } from "./prose";

const wrap = (block: Block) => ({ block });

describe("skipping the blocks that did not change", () => {
  it("says two identical paragraphs are the same", () => {
    // `parseBlocks` builds fresh objects every run, so reference equality is
    // always false and `memo` on its own would never skip anything. This is
    // what makes it work.
    const [before] = parseBlocks("A paragraph.");
    const [after] = parseBlocks("A paragraph.");
    expect(before).not.toBe(after);
    expect(same(wrap(before), wrap(after))).toBe(true);
  });

  it("notices the block that is still being written", () => {
    const [before] = parseBlocks("Half a sen");
    const [after] = parseBlocks("Half a sentence.");
    expect(same(wrap(before), wrap(after))).toBe(false);
  });

  it("holds for every kind, not only paragraphs", () => {
    const source = "# A heading\n\n```py\nx = 1\n```\n\n- one\n- two\n\n> quoted";
    const before = parseBlocks(source);
    const after = parseBlocks(source);
    expect(before.length).toBeGreaterThan(3);
    for (let at = 0; at < before.length; at += 1) {
      expect(same(wrap(before[at]), wrap(after[at]))).toBe(true);
    }
  });

  it("notices a changed list item and a changed fence", () => {
    expect(
      same(wrap(parseBlocks("- one\n- two")[0]), wrap(parseBlocks("- one\n- three")[0])),
    ).toBe(false);
    expect(
      same(
        wrap(parseBlocks("```py\nx = 1\n```")[0]),
        wrap(parseBlocks("```js\nx = 1\n```")[0]),
      ),
    ).toBe(false);
  });

  it("never calls two different kinds the same", () => {
    const heading = parseBlocks("# Title")[0];
    const paragraph = parseBlocks("Title")[0];
    expect(same(wrap(heading), wrap(paragraph))).toBe(false);
  });
});
