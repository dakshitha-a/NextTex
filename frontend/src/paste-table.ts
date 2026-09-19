import { escapeLatex } from "./latex-escape";

/** Comma- or tab-separated text on the clipboard as a booktabs table.
 *
 *  A spreadsheet's copy is tab-separated, a `.csv` is comma-separated,
 *  and either pasted into a chapter arrives as lines of text the writer
 *  then retypes with ampersands.  This decides whether what was pasted
 *  is a table, and writes the table if it is: at least two lines, every
 *  line with the same count of one delimiter, tab first, then comma,
 *  then semicolon, and at least two columns; quoted fields are read, so a
 *  cell with a comma in it stays one cell.  A paragraph of prose with
 *  commas in it fails the same-count rule and is pasted as text.
 *
 *  The first row is the header above `\midrule`; a column whose every
 *  body cell is a number is right-aligned.  Pure, so the cases are a
 *  vitest.
 */

const DELIMITERS = ["\t", ",", ";"] as const;
const NUMBER = /^[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?%?$/;

/** One line's fields, honouring double quotes around a field and a
 *  doubled quote inside one. */
export function splitLine(line: string, delimiter: string): string[] {
  const fields: string[] = [];
  let field = "";
  let quoted = false;
  for (let at = 0; at < line.length; at += 1) {
    const char = line[at];
    if (quoted) {
      if (char === '"' && line[at + 1] === '"') {
        field += '"';
        at += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        field += char;
      }
    } else if (char === '"' && field === "") {
      quoted = true;
    } else if (char === delimiter) {
      fields.push(field);
      field = "";
    } else {
      field += char;
    }
  }
  fields.push(field);
  return fields.map((cell) => cell.trim());
}

/** The rows, or null when the text is not a table. */
export function parseTable(text: string): string[][] | null {
  const lines = text.replace(/\r\n?/g, "\n").split("\n").filter((line) => line.trim() !== "");
  if (lines.length < 2) return null;
  for (const delimiter of DELIMITERS) {
    const rows = lines.map((line) => splitLine(line, delimiter));
    const width = rows[0].length;
    if (width < 2) continue;
    if (rows.every((row) => row.length === width)) return rows;
  }
  return null;
}

/** The table, or null when the text is not one. */
export function tableFromClipboard(text: string): string | null {
  const rows = parseTable(text);
  if (!rows) return null;
  const [header, ...body] = rows;
  const columns = header.map((_cell, index) => {
    const cells = body.map((row) => row[index]);
    return cells.length > 0 && cells.every((cell) => cell === "" || NUMBER.test(cell)) ? "r" : "l";
  });
  const line = (row: string[]) => "    " + row.map(escapeLatex).join(" & ") + " \\\\";
  return [
    "\\begin{table}[htbp]",
    "  \\centering",
    "  \\caption{}",
    "  \\label{tab:}",
    `  \\begin{tabular}{${columns.join("")}}`,
    "    \\toprule",
    line(header),
    "    \\midrule",
    ...body.map(line),
    "    \\bottomrule",
    "  \\end{tabular}",
    "\\end{table}",
    "",
  ].join("\n");
}

/** Where the caret lands after a paste: inside `\caption{}`. */
export function captionOffset(table: string): number {
  return table.indexOf("\\caption{") + "\\caption{".length;
}

/** The figure a pasted image becomes, once it is saved. */
export function figureFor(path: string): string {
  return [
    "\\begin{figure}[htbp]",
    "  \\centering",
    `  \\includegraphics[width=0.8\\linewidth]{${path}}`,
    "  \\caption{}",
    "  \\label{fig:}",
    "\\end{figure}",
    "",
  ].join("\n");
}
