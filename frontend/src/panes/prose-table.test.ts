import { describe, expect, it } from "vitest";

import { lineOf, sameWithLines } from "./markdown-source";
import { parseBlocks, same, splitRow, type Block } from "./prose";

/** A pipe table is a table.  The agent answers with one often, and the
 *  chat showed it as lines of pipes and dashes; the Markdown pane, which
 *  reads with the same parser, showed a README's the same way. */

const FITS = [
  "| Solvent | ε | τ₁ (fs) |",      // 1
  "|---|:-:|--:|",                     // 2
  "| Hexane | 1.9 | 182 |",            // 3
  "| Water | 80.1 | **158** |",        // 4
].join("\n");

describe("a pipe table", () => {
  it("is one table block with its header, alignment and rows", () => {
    const blocks = parseBlocks(FITS);
    expect(blocks).toHaveLength(1);
    const table = blocks[0];
    expect(table.kind).toBe("table");
    if (table.kind !== "table") return;
    expect(table.header).toEqual(["Solvent", "ε", "τ₁ (fs)"]);
    expect(table.align).toEqual([null, "center", "right"]);
    expect(table.rows).toEqual([
      ["Hexane", "1.9", "182"],
      ["Water", "80.1", "**158**"],
    ]);
    expect(table.line).toBe(1);
    expect(table.lines).toEqual([3, 4]);
  });

  it("needs no outer pipes", () => {
    const table = parseBlocks("a | b\n--- | ---\n1 | 2")[0];
    expect(table.kind).toBe("table");
    if (table.kind === "table") expect(table.rows).toEqual([["1", "2"]]);
  });

  it("forms straight under a sentence, with no blank line between", () => {
    // Models write "Here they are:" directly above the header, and the
    // paragraph must not swallow it.
    const blocks = parseBlocks(`The fits:\n${FITS}\nAnd after.`);
    expect(blocks.map((block) => block.kind)).toEqual(["paragraph", "table", "paragraph"]);
    expect(blocks[0].kind === "paragraph" && blocks[0].text).toBe("The fits:");
    expect(blocks[2].line).toBe(6);
  });

  it("ends at a blank line", () => {
    const blocks = parseBlocks(`${FITS}\n\n| not | a row |`);
    expect(blocks.map((block) => block.kind)).toEqual(["table", "paragraph"]);
  });

  it("pads a short row and cuts a long one to the header's columns", () => {
    const table = parseBlocks("| a | b |\n|---|---|\n| 1 |\n| 1 | 2 | 3 |")[0];
    expect(table.kind === "table" && table.rows).toEqual([["1", ""], ["1", "2"]]);
  });

  it("keeps an escaped pipe inside its cell", () => {
    expect(splitRow("| a \\| b | c |")).toEqual(["a | b", "c"]);
    const table = parseBlocks("| x | y |\n|---|---|\n| `a\\|b` | 2 |")[0];
    expect(table.kind === "table" && table.rows[0]).toEqual(["`a|b`", "2"]);
  });

  it("is not a sentence that happens to hold a pipe", () => {
    expect(parseBlocks("Use a | b here.\nThen go on.").map((b) => b.kind)).toEqual(["paragraph"]);
  });

  it("is not a heading underlined with dashes", () => {
    expect(parseBlocks("Title\n---").map((b) => b.kind)).toEqual(["paragraph"]);
  });

  it("needs as many delimiter cells as header cells", () => {
    expect(parseBlocks("| a | b | c |\n|---|---|").map((b) => b.kind)).toEqual(["paragraph"]);
  });
});

/** While an answer streams in, the table arrives a line at a time. */
describe("a table still streaming", () => {
  it("reads as a paragraph with only its header", () => {
    expect(parseBlocks("| a | b | c |").map((b) => b.kind)).toEqual(["paragraph"]);
  });

  it("reads as a paragraph with half a delimiter row", () => {
    expect(parseBlocks("| a | b | c |\n|---|--").map((b) => b.kind)).toEqual(["paragraph"]);
  });

  it("is a table with no rows once its delimiter row is whole", () => {
    const table = parseBlocks("| a | b | c |\n|---|---|---|")[0];
    expect(table.kind).toBe("table");
    if (table.kind === "table") {
      expect(table.header).toHaveLength(3);
      expect(table.rows).toEqual([]);
    }
  });
});

describe("comparing tables", () => {
  const one = parseBlocks(FITS)[0];

  it("finds a re-parsed table the same, so the chat skips redrawing it", () => {
    expect(same({ block: one }, { block: parseBlocks(FITS)[0] })).toBe(true);
  });

  it("finds a changed cell, a new row and a new alignment different", () => {
    const cell = parseBlocks(FITS.replace("182", "183"))[0];
    const row = parseBlocks(`${FITS}\n| Ethanol | 24.5 | 170 |`)[0];
    const side = parseBlocks(FITS.replace("|:-:|", "|:--|"))[0];
    for (const other of [cell, row, side]) {
      expect(same({ block: one }, { block: other })).toBe(false);
    }
  });

  it("finds a moved table different in the Markdown pane, which draws its lines", () => {
    const moved = parseBlocks(`\n\n${FITS}`)[0];
    expect(same({ block: one }, { block: moved })).toBe(true);
    expect(sameWithLines({ block: one }, { block: moved })).toBe(false);
  });

  it("goes to the header's line from anywhere in the table but a row", () => {
    // A row's own line comes from its `<tr>`, as a list item's does.
    expect(lineOf(one as Block, "Water")).toBe(1);
  });
});
