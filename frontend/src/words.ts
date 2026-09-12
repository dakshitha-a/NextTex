import type { Heading } from "./outline";

/** Which lines a scope covers, or null when the whole file is the answer.
 *
 *  Pulled out of the component because it is arithmetic over an outline
 *  and a cursor position and needs neither React nor a server to describe,
 *  and because the section case has an edge on both ends: the last section
 *  in a file runs to the end of it, and a cursor above the first heading is
 *  in no section at all.
 */
export function rangeFor(
  scope: string,
  outline: Heading[],
  cursorLine: number,
  lines: number,
  selection: { fromLine: number; toLine: number } | null,
): { first: number; last: number } | null {
  if (scope === "selection") {
    return selection ? { first: selection.fromLine, last: selection.toLine } : null;
  }
  if (scope !== "section") return null;
  // File rows are the outline's way of showing which .tex a heading came
  // from; they are not sections and a cursor is never inside one.
  const headings = outline.filter((row) => row.kind !== "file");
  let start: Heading | null = null;
  let next: Heading | null = null;
  for (const heading of headings) {
    if (heading.line <= cursorLine) {
      // A deeper heading starts a new section; so does a shallower one.
      // Either way the nearest heading above the cursor is the one the
      // cursor is under.
      if (!start || heading.line >= start.line) start = heading;
    } else if (!next) {
      next = heading;
    }
  }
  if (!start) return null;
  return { first: start.line, last: next ? next.line - 1 : lines };
}

/** The scopes in the order the control cycles them.
 *
 *  Selection is offered only when there is one: a scope that counts
 *  nothing is a stop on the cycle that reads as the control being broken.
 */
export function scopesFor(hasSelection: boolean): string[] {
  return hasSelection
    ? ["file", "document", "selection", "section"]
    : ["file", "document", "section"];
}

/** What the strip says for a scope. */
export function labelFor(scope: string, count: number): string {
  const words = count.toLocaleString();
  if (scope === "document") return `${words} words`;
  if (scope === "file") return `${words} in file`;
  if (scope === "selection") return `${words} selected`;
  return `${words} in section`;
}
