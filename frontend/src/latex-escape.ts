/** Text as LaTeX will print it: the ten characters that mean something
 *  to TeX, escaped.
 *
 *  A cell pasted from a spreadsheet says `50%` or `R&D` or `a_b`, and
 *  each of those is a build error or a subscript rather than the cell.
 *  One pass over the text, so an escape's own braces are never escaped
 *  by a second one. */

const ESCAPE: Record<string, string> = {
  "\\": "\\textbackslash{}",
  "&": "\\&",
  "%": "\\%",
  "$": "\\$",
  "#": "\\#",
  "_": "\\_",
  "{": "\\{",
  "}": "\\}",
  "~": "\\textasciitilde{}",
  "^": "\\textasciicircum{}",
};

export function escapeLatex(text: string): string {
  return text.replace(/[\\&%$#_{}~^]/g, (found) => ESCAPE[found]);
}
