import { describe, expect, it } from "vitest";
import { escapeLatex } from "./latex-escape";
import { captionOffset, figureFor, parseTable, splitLine, tableFromClipboard } from "./paste-table";

describe("escaping for LaTeX", () => {
  it("escapes the ten characters TeX reads, once each", () => {
    expect(escapeLatex("R&D 50% $5 #1 a_b {x} ~ ^ \\")).toBe(
      "R\\&D 50\\% \\$5 \\#1 a\\_b \\{x\\} \\textasciitilde{} \\textasciicircum{} \\textbackslash{}",
    );
  });

  it("leaves ordinary text alone", () => {
    expect(escapeLatex("Energy (eV), 3.41")).toBe("Energy (eV), 3.41");
  });
});

describe("deciding what is a table", () => {
  it("reads tab-separated text, the spreadsheet's copy", () => {
    const rows = parseTable("State\tEnergy\nFirst\t3.41\nSecond\t4.07\n");
    expect(rows).toEqual([["State", "Energy"], ["First", "3.41"], ["Second", "4.07"]]);
  });

  it("reads comma-separated text with quoted fields", () => {
    expect(splitLine('a,"b, c","say ""hi""",d', ",")).toEqual(["a", "b, c", 'say "hi"', "d"]);
    expect(parseTable('name,note\nx,"one, two"\ny,three')).toEqual([["name", "note"], ["x", "one, two"], ["y", "three"]]);
  });

  it("refuses a paragraph of prose with commas in it", () => {
    const prose = "This sentence has one comma, and this one has two, or maybe three, of them.\nA second line, with one.";
    expect(parseTable(prose)).toBeNull();
    expect(tableFromClipboard(prose)).toBeNull();
  });

  it("refuses one line, and one column", () => {
    expect(parseTable("a,b,c")).toBeNull();
    expect(parseTable("one\ntwo\nthree")).toBeNull();
  });

  it("prefers a tab over a comma when both are present", () => {
    expect(parseTable("a, b\tc\nd, e\tf")).toEqual([["a, b", "c"], ["d, e", "f"]]);
  });
});

describe("the table written", () => {
  it("is a booktabs table with a header, numbers right-aligned and cells escaped", () => {
    const table = tableFromClipboard("State\tEnergy (eV)\tShare\nFirst\t3.41\t50%\nSecond\t4.07\tR&D");
    expect(table).toBe([
      "\\begin{table}[htbp]",
      "  \\centering",
      "  \\caption{}",
      "  \\label{tab:}",
      "  \\begin{tabular}{lrl}",
      "    \\toprule",
      "    State & Energy (eV) & Share \\\\",
      "    \\midrule",
      "    First & 3.41 & 50\\% \\\\",
      "    Second & 4.07 & R\\&D \\\\",
      "    \\bottomrule",
      "  \\end{tabular}",
      "\\end{table}",
      "",
    ].join("\n"));
    expect(table!.slice(captionOffset(table!) - 9, captionOffset(table!))).toBe("\\caption{");
  });

  it("writes the figure for a saved image", () => {
    expect(figureFor("figures/pasted-2026-09-19.png")).toContain(
      "\\includegraphics[width=0.8\\linewidth]{figures/pasted-2026-09-19.png}",
    );
  });
});
