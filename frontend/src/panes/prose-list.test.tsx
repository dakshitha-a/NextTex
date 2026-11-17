import { afterEach, describe, expect, it } from "vitest";

import { itemLineOf } from "./markdown-source";
import Prose, { parseBlocks, same, type Block } from "./prose";
import { mount } from "../ui/mount";

/** Numbered lists with an explanation under each item.
 *
 *  A model writes a title on the item's line and its explanation three
 *  spaces in on the line below.  The parser used to stop the list at the
 *  indented line, make it a paragraph, and open a new list at the next
 *  number, so every item read "1." and the explanations stood outside
 *  the list, flush left. */

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const REPORTED = [
  "1. **Title A**",
  "   Explanation paragraph indented 3 spaces under the item.",
  "2. **Title B**",
  "   Explanation paragraph.",
  "3. **Title C**",
  "   ...",
].join("\n");

const kinds = (source: string) => parseBlocks(source).map((block) => block.kind);
const list = (block: Block) => {
  if (block.kind !== "list") throw new Error(`a ${block.kind}, not a list`);
  return block;
};

describe("a list item's continuation lines", () => {
  it("keeps the reported list as one list of three", () => {
    const blocks = parseBlocks(REPORTED);
    expect(blocks.map((block) => block.kind)).toEqual(["list"]);
    const one = list(blocks[0]);
    expect(one.items).toEqual([
      "**Title A**\nExplanation paragraph indented 3 spaces under the item.",
      "**Title B**\nExplanation paragraph.",
      "**Title C**\n...",
    ]);
    expect(one.lines).toEqual([1, 3, 5]);
    expect(one.start).toBe(1);
  });

  it("takes a bulleted item's two-space continuation too", () => {
    const one = list(parseBlocks("- first\n  more of it\n- second")[0]);
    expect(one.items).toEqual(["first\nmore of it", "second"]);
  });

  it("keeps a blank line inside an item as an empty line", () => {
    // One text line per source line, so the Markdown pane can count.
    const one = list(parseBlocks("1. Title\n\n   Second paragraph.\n2. Next")[0]);
    expect(one.items).toEqual(["Title\n\nSecond paragraph.", "Next"]);
    expect(one.lines).toEqual([1, 4]);
  });

  it("keeps a loose list, items parted by blank lines, as one list", () => {
    const blocks = parseBlocks("1. a\n\n2. b\n\n3. c");
    expect(blocks.map((block) => block.kind)).toEqual(["list"]);
    expect(list(blocks[0]).items).toEqual(["a", "b", "c"]);
    expect(list(blocks[0]).lines).toEqual([1, 3, 5]);
  });

  it("ends the list at an unindented sentence, with or without a blank line", () => {
    expect(kinds("1. a\n2. b\nAfter the list.")).toEqual(["list", "paragraph"]);
    expect(kinds("1. a\n2. b\n\nAfter the list.")).toEqual(["list", "paragraph"]);
  });

  it("does not run a numbered list into a bulleted one after a blank line", () => {
    expect(kinds("1. a\n\n- b")).toEqual(["list", "list"]);
  });

  it("leaves trailing blank lines to the block after", () => {
    const blocks = parseBlocks("- a\n\n\nNext.");
    expect(blocks.map((block) => [block.kind, block.line])).toEqual([
      ["list", 1],
      ["paragraph", 4],
    ]);
  });
});

describe("the number a list starts at", () => {
  it("is the first item's number, so a split list goes on counting", () => {
    const blocks = parseBlocks("1. a\n2. b\n\nAn aside.\n\n3. c\n4. d");
    expect(blocks.map((block) => block.kind)).toEqual(["list", "paragraph", "list"]);
    expect(list(blocks[0]).start).toBe(1);
    expect(list(blocks[2]).start).toBe(3);
  });

  it("is told apart by the memo, so a renumbered list is drawn again", () => {
    const wrap = (block: Block) => ({ block });
    const [one] = parseBlocks("2. a");
    const [two] = parseBlocks("5. a");
    expect(same(wrap(one), wrap(two))).toBe(false);
  });
});

describe("drawing it", () => {
  let mounted: { unmount: () => void } | null = null;
  afterEach(() => {
    mounted?.unmount();
    mounted = null;
  });
  const draw = (source: string) => {
    const m = (mounted = mount(<Prose text={source} />));
    return m.container;
  };

  it("draws the reported list as one <ol> with the explanation in each <li>", () => {
    const page = draw(REPORTED);
    expect(page.querySelectorAll("ol")).toHaveLength(1);
    const items = [...page.querySelectorAll("ol > li")];
    expect(items).toHaveLength(3);
    expect(items[0].textContent).toBe(
      "Title A\nExplanation paragraph indented 3 spaces under the item.",
    );
    expect(items[0].querySelector("strong")?.textContent).toBe("Title A");
    expect(page.querySelectorAll(":scope > div > p")).toHaveLength(0);
    expect(page.querySelector("ol")!.hasAttribute("start")).toBe(false);
  });

  it("sets start on a list that does not begin at 1", () => {
    const page = draw("1. a\n\nAn aside.\n\n2. b");
    const lists = page.querySelectorAll("ol");
    expect(lists).toHaveLength(2);
    expect(lists[1].getAttribute("start")).toBe("2");
  });

  it("draws an item's blank-line paragraphs as paragraphs under one marker", () => {
    const page = draw("1. Title\n\n   Second paragraph.\n2. Next");
    const first = page.querySelector("ol > li")!;
    expect([...first.querySelectorAll("p")].map((p) => p.textContent)).toEqual([
      "Title",
      "Second paragraph.",
    ]);
  });
});

describe("the line a double-click in a list item lands on", () => {
  it("finds a word on the item's continuation line", () => {
    const blocks = parseBlocks(`Intro.\n\n${REPORTED}`);
    // The second item starts on line 5; its explanation is line 6.
    expect(itemLineOf(blocks, 5, "Explanation")).toBe(6);
    expect(itemLineOf(blocks, 5, "Title")).toBe(5);
    expect(itemLineOf(blocks, 5, "elsewhere")).toBe(5);
  });

  it("counts past a blank line inside the item", () => {
    const blocks = parseBlocks("1. Title\n\n   Second paragraph.\n2. Next");
    expect(itemLineOf(blocks, 1, "Second")).toBe(3);
  });
});
