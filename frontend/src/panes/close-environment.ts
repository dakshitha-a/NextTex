/** The `\end{x}` a `\begin{x}` is waiting for.
 *
 *  Typing `\begin{figure}` by hand and pressing Enter left the writer to
 *  type the closing line themselves. The pair was only ever written when
 *  the completion list was used, which is the case where the writer
 *  already knew the environment's name and so needed the help least.
 */

const BEGIN = /^\s*\\begin\{([^}]+)\}/;

function count(text: string, pattern: string): number {
  return (text.match(new RegExp(pattern, "g")) ?? []).length;
}

/** The environment to close, or null.
 *
 *  `whole` is the entire document, including the line just typed, and the
 *  question asked of it is the only one that answers this correctly: are
 *  there more `\begin{x}` than `\end{x}` in it. A rule that looked only at
 *  the text below the caret cannot tell an unclosed block from a closed
 *  one whose `\end` belongs to a block further up, and both of those
 *  happen constantly while somebody is writing a nested list.
 *
 *  Counting the whole document rather than parsing it: an `\end` inside a
 *  comment or a verbatim block would be miscounted, and the cost of that
 *  is one closing line the writer deletes, against a parse of the buffer
 *  on every press of Enter.
 */
export function environmentToClose(line: string, whole: string): string | null {
  const found = BEGIN.exec(line);
  if (!found) return null;
  const name = found[1];
  if (!name || name.includes("\\")) return null;
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const opens = count(whole, `\\\\begin\\{${escaped}\\}`);
  const closes = count(whole, `\\\\end\\{${escaped}\\}`);
  return opens > closes ? name : null;
}

/** The indentation to give the block, taken from the line that opened it. */
export function indentOf(line: string): string {
  return /^[ \t]*/.exec(line)?.[0] ?? "";
}
