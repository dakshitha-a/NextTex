import { describe, expect, test } from "vitest";
import { columnsOf, parseTabular, plainText, MAX_ROWS } from "./table-hover";
import { tableAt } from "./math-hover";

/** Reading a table's body for the hover card.  Each case is a shape a
 *  chemist's table takes, and each was silent when wrong: the card drew
 *  the wrong number of columns, or a cell in the wrong place. */

const BOOKTABS = `\\begin{tabular}{lcr}
\\toprule
Solvent & $\\varepsilon$ & $\\tau$ (ps) \\\\
\\midrule
Hexane & 1.9 & 12.4 \\\\
Acetonitrile & 37.5 & 3.1 \\\\
Water & 80.1 & 0.8 \\\\
\\bottomrule
\\end{tabular}`;

describe("a booktabs table", () => {
  const table = parseTabular(BOOKTABS)!;

  test("has its columns from the spec and its rows from the body", () => {
    expect(table.columns).toEqual(["l", "c", "r"]);
    expect(table.rows.map((row) => row.cells.map((cell) => cell.text))).toEqual([
      ["Solvent", "$\\varepsilon$", "$\\tau$ (ps)"],
      ["Hexane", "1.9", "12.4"],
      ["Acetonitrile", "37.5", "3.1"],
      ["Water", "80.1", "0.8"],
    ]);
    expect(table.head).toBe("\\begin{tabular}{lcr}");
    expect(table.more).toBe(0);
  });

  test("reads the rules as a rule over the row that follows, and the bottom", () => {
    expect(table.rows.map((row) => row.rule)).toEqual([true, true, false, false]);
    expect(table.bottom).toBe(true);
  });

  test("keeps a cell that is maths for KaTeX", () => {
    expect(table.rows[0].cells[1].math).toBe("\\varepsilon");
    // Maths with text beside it is text: KaTeX would not take the "(ps)".
    expect(table.rows[0].cells[2].math).toBeUndefined();
    expect(table.rows[0].cells[2].text).toBe("$\\tau$ (ps)");
  });
});

describe("the awkward cells", () => {
  test("a multicolumn header spans, with its own alignment", () => {
    const table = parseTabular(
      "\\begin{tabular}{lrr}\\hline\\multicolumn{3}{c}{\\textbf{Yields}} \\\\ \\hline a & 1 & 2 \\\\ \\hline\\end{tabular}",
    )!;
    expect(table.rows[0].cells).toEqual([
      { text: "Yields", span: 3, align: "c", bold: true, italic: false },
    ]);
    expect(table.rows[1].cells.map((cell) => cell.text)).toEqual(["a", "1", "2"]);
    expect(table.rows.map((row) => row.rule)).toEqual([true, true]);
    expect(table.bottom).toBe(true);
  });

  test("an escaped ampersand stays in its cell, and a \\\\ inside braces does not end the row", () => {
    const table = parseTabular(
      "\\begin{tabular}{ll} Smith \\& Jones & \\parbox{2cm}{one \\\\ two} \\\\ next & row \\end{tabular}",
    )!;
    expect(table.rows.map((row) => row.cells.map((cell) => cell.text))).toEqual([
      ["Smith & Jones", "2cm one \\\\ two"],
      ["next", "row"],
    ]);
  });

  test("a cell holding $x^2$ is maths, and emphasis is read as slant", () => {
    const table = parseTabular("\\begin{tabular}{cc} $x^2$ & \\emph{yes} \\\\ \\end{tabular}")!;
    expect(table.rows[0].cells[0]).toMatchObject({ math: "x^2", span: 1 });
    expect(table.rows[0].cells[1]).toMatchObject({ text: "yes", italic: true });
  });

  test("tabular* and tabularx carry a width before the spec, and longtable does not", () => {
    expect(parseTabular("\\begin{tabular*}{\\textwidth}{@{\\extracolsep{\\fill}}lr@{}} a & b \\\\ \\end{tabular*}")!.columns)
      .toEqual(["l", "r"]);
    expect(parseTabular("\\begin{tabularx}{\\linewidth}{lX} a & b \\\\ \\end{tabularx}")!.columns)
      .toEqual(["l", "l"]);
    expect(parseTabular("\\begin{longtable}{p{3cm}c} a & b \\\\ \\end{longtable}")!.columns)
      .toEqual(["l", "c"]);
  });

  test("a row's optional space after \\\\ and a comment are not cells", () => {
    const table = parseTabular("\\begin{tabular}{ll} a & b \\\\[4pt] % a note\n c & d \\\\ \\end{tabular}")!;
    expect(table.rows.map((row) => row.cells.map((cell) => cell.text))).toEqual([["a", "b"], ["c", "d"]]);
  });

  test("more rows than the card draws are counted, not drawn", () => {
    const rows = Array.from({ length: MAX_ROWS + 4 }, (_, i) => `r${i} & ${i}`).join(" \\\\ ");
    const table = parseTabular(`\\begin{tabular}{lr} ${rows} \\\\ \\end{tabular}`)!;
    expect(table.rows).toHaveLength(MAX_ROWS);
    expect(table.more).toBe(4);
  });
});

describe("the helpers", () => {
  test("a column spec's letters, widths, rules and repeats", () => {
    expect(columnsOf("|l|c|r|")).toEqual(["l", "c", "r"]);
    expect(columnsOf("@{}p{3cm}X@{}")).toEqual(["l", "l"]);
    expect(columnsOf("*{3}{c}r")).toEqual(["c", "c", "c", "r"]);
  });

  test("a cell's commands reduce to their text", () => {
    expect(plainText("\\textsc{Total} \\% yield")).toBe("Total % yield");
    expect(plainText("\\SI{2.7}{\\electronvolt}")).toBe("2.7 electronvolt");
    expect(plainText("a~b")).toBe("a b");
  });
});

describe("finding the table under the pointer", () => {
  const text = `Some prose.\n\n${BOOKTABS}\n\nMore prose with $x$ in it.`;

  test("inside the environment, the whole environment", () => {
    const at = text.indexOf("Hexane") + 2;
    const span = tableAt(text, at)!;
    expect(text.slice(span.from, span.to)).toBe(BOOKTABS);
  });

  test("in the prose beside it, nothing", () => {
    expect(tableAt(text, 3)).toBeNull();
    expect(tableAt(text, text.indexOf("More") + 2)).toBeNull();
  });
});
