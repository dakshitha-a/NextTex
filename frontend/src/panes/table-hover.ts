/** A table's body, read for the hover card.
 *
 *  Resting the pointer inside a `tabular`, `tabular*`, `tabularx` or
 *  `longtable` opens the same card the formula hover uses, with the table
 *  drawn as an HTML table in the card's body.  This is the reading half:
 *  rows split on `\\` and cells on `&`, both outside braces, with `\&`
 *  kept as an ampersand; the booktabs and `\hline` rules read as a rule
 *  over the row that follows (or under the last); `\multicolumn{n}{a}{x}`
 *  as a cell spanning n columns; `\textbf` and `\emph` as weight and
 *  slant; an inline `$…$` in a cell kept as maths for KaTeX; any other
 *  command reduced to its arguments' text.  The card draws at most thirty
 *  rows and twelve columns and says how many more there are.
 *
 *  Pure, so it is tested without a browser; `math-hover.ts` finds the
 *  environment under the pointer and draws what this returns.
 */

export type Align = "l" | "c" | "r";

export type Cell = {
  /** The cell's text, commands reduced, or the maths when `math` is set. */
  text: string;
  /** Inline maths, the source between the dollars, for KaTeX. */
  math?: string;
  /** How many columns the cell spans; 1 for an ordinary cell. */
  span: number;
  /** An alignment of the cell's own, from `\multicolumn`. */
  align?: Align;
  bold?: boolean;
  italic?: boolean;
};

export type Row = {
  cells: Cell[];
  /** A rule over this row: `\hline`, `\toprule`, `\midrule`, `\cline`
   *  or `\cmidrule` came before it. */
  rule: boolean;
};

export type Table = {
  columns: Align[];
  rows: Row[];
  /** Rows the body holds beyond the ones drawn. */
  more: number;
  /** A rule after the last row: `\bottomrule` or a closing `\hline`. */
  bottom: boolean;
  /** The environment's opening line, for the source under the drawing. */
  head: string;
};

export const MAX_ROWS = 30;
export const MAX_COLUMNS = 12;

const OPENING = /^\s*\\begin\{(tabular\*?|tabularx|longtable)\}/;

/** The table an environment's whole text describes, from `\begin` to
 *  `\end`, or null when the text is not one. */
export function parseTabular(source: string): Table | null {
  const open = OPENING.exec(source);
  if (!open) return null;
  let at = open[0].length;
  // tabular* and tabularx take a width before the column spec.
  if (open[1] !== "tabular" && open[1] !== "longtable") {
    const width = group(source, at);
    if (!width) return null;
    at = width.end;
  }
  const spec = group(source, at);
  if (!spec) return null;
  const head = source.slice(open.index, spec.end).trim();
  const columns = columnsOf(spec.text);
  const close = source.lastIndexOf(`\\end{${open[1]}}`);
  const body = source.slice(spec.end, close === -1 ? source.length : close);

  const rows: Row[] = [];
  let rule = false;
  let bottom = false;
  for (const raw of splitOutsideBraces(stripComments(body), "\\\\")) {
    let text = raw.replace(/^\s*\[[^\]]*\]/, "");
    // The rules at the head of the row, any number of them.
    let found = true;
    while (found) {
      found = false;
      const match = /^\s*\\(?:hline|toprule|midrule|bottomrule|cline\s*\{[^}]*\}|cmidrule(?:\([^)]*\))?\s*\{[^}]*\})/.exec(text);
      if (match) {
        rule = true;
        text = text.slice(match[0].length);
        found = true;
      }
    }
    if (!text.trim()) {
      // Only rules, or nothing: after the last row that is the bottom.
      if (rule && rows.length) bottom = true;
      continue;
    }
    const cells = splitOutsideBraces(text, "&").map(cellOf);
    rows.push({ cells, rule });
    rule = false;
    bottom = false;
  }
  const drawn = rows.slice(0, MAX_ROWS);
  for (const row of drawn) {
    if (row.cells.length > MAX_COLUMNS) row.cells = row.cells.slice(0, MAX_COLUMNS);
  }
  return {
    columns: columns.slice(0, MAX_COLUMNS),
    rows: drawn,
    more: rows.length - drawn.length,
    bottom,
    head,
  };
}

/** The alignment of each column from a spec such as `l c r`, `@{}lr@{}`,
 *  `p{3cm}` or `X`: `p`, `m`, `b` and `X` read as left, `|` and `@{}`
 *  as nothing. */
export function columnsOf(spec: string): Align[] {
  const columns: Align[] = [];
  let i = 0;
  while (i < spec.length) {
    const ch = spec[i];
    if (ch === "l" || ch === "c" || ch === "r") {
      columns.push(ch);
      i += 1;
    } else if (ch === "p" || ch === "m" || ch === "b" || ch === "X") {
      columns.push("l");
      i += 1;
      const arg = group(spec, i);
      if (arg) i = arg.end;
    } else if (ch === "@" || ch === "!" || ch === ">" || ch === "<") {
      i += 1;
      const arg = group(spec, i);
      if (arg) i = arg.end;
    } else if (ch === "*") {
      // *{3}{c}: three of the same.
      const count = group(spec, i + 1);
      const what = count && group(spec, count.end);
      if (count && what) {
        const times = Number.parseInt(count.text, 10) || 0;
        const inner = columnsOf(what.text);
        for (let n = 0; n < times; n += 1) columns.push(...inner);
        i = what.end;
      } else {
        i += 1;
      }
    } else {
      i += 1;
    }
  }
  return columns;
}

function cellOf(raw: string): Cell {
  let text = raw.trim();
  let span = 1;
  let align: Align | undefined;
  const multi = /^\\multicolumn\s*/.exec(text);
  if (multi) {
    const n = group(text, multi[0].length);
    const a = n && group(text, n.end);
    const inner = a && group(text, a.end);
    if (n && a && inner) {
      span = Math.max(1, Number.parseInt(n.text, 10) || 1);
      align = columnsOf(a.text)[0];
      text = inner.text.trim();
    }
  }
  let bold = false;
  let italic = false;
  const weight = /^\\(textbf|emph|textit)\s*/.exec(text);
  if (weight) {
    const inner = group(text, weight[0].length);
    if (inner && inner.end === text.length) {
      if (weight[1] === "textbf") bold = true;
      else italic = true;
      text = inner.text.trim();
    }
  }
  const maths = /^\$([^$]+)\$$/.exec(text);
  if (maths) return { text, math: maths[1].trim(), span, align, bold, italic };
  return { text: plainText(text), span, align, bold, italic };
}

/** The text of a cell with its commands reduced: `\textbf{x}` to x, the
 *  arguments of a command with several kept in order (`\SI{2.7}{\eV}`
 *  reads "2.7 eV"), a bare `\command` reduced to its name, `\&` and `\%`
 *  unescaped, `~` a space.  Inline maths inside the cell is kept as
 *  written, dollars and all, for the card to set through KaTeX. */
export function plainText(text: string): string {
  const maths: string[] = [];
  let out = text.replace(/\$[^$]+\$/g, (span) => {
    maths.push(span);
    return `\u0001${maths.length - 1}\u0001`;
  });
  for (let guard = 0; guard < 20; guard += 1) {
    const before = out;
    out = out.replace(/\\[A-Za-z]+\*?\s*(?:\[[^\]]*\])?\s*\{/g, "{");
    if (out === before) break;
  }
  out = out
    .replace(/\\([&%#_$])/g, "\u0000$1")
    .replace(/\}\s*\{/g, " ")
    .replace(/[{}]/g, "")
    .replace(/\\([A-Za-z]+)\*?/g, "$1");
  out = out.replace(/\u0001(\d+)\u0001/g, (_, index) => maths[Number(index)]);
  return out.replace(/\u0000/g, "").replace(/~/g, " ").replace(/\s+/g, " ").trim();
}

function stripComments(text: string): string {
  return text.replace(/(^|[^\\])%.*$/gm, "$1");
}

/** A brace group starting at `at` (after optional spaces): its text and
 *  where it ends, or null when there is none. */
function group(text: string, at: number): { text: string; end: number } | null {
  let i = at;
  while (i < text.length && /\s/.test(text[i])) i += 1;
  if (text[i] !== "{") return null;
  let depth = 0;
  for (let j = i; j < text.length; j += 1) {
    const ch = text[j];
    if (ch === "\\") {
      j += 1;
      continue;
    }
    if (ch === "{") depth += 1;
    if (ch === "}") {
      depth -= 1;
      if (depth === 0) return { text: text.slice(i + 1, j), end: j + 1 };
    }
  }
  return null;
}

/** Split on a separator that is outside braces and not escaped: `\\` for
 *  rows, `&` for cells; `\&` stays in the cell. */
function splitOutsideBraces(text: string, separator: "\\\\" | "&"): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (ch === "\\") {
      if (separator === "\\\\" && text[i + 1] === "\\" && depth === 0) {
        parts.push(text.slice(start, i));
        i += 1;
        start = i + 1;
        continue;
      }
      // Any other escaped character, `\&` among them, is skipped whole.
      i += 1;
      continue;
    }
    if (ch === "{") depth += 1;
    else if (ch === "}") depth = Math.max(0, depth - 1);
    else if (separator === "&" && ch === "&" && depth === 0) {
      parts.push(text.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(text.slice(start));
  return parts;
}
