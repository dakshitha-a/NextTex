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
  // An abstract ends at its \end, not at the heading after it: the title
  // block between the two is in no section.
  if (start.kind === "abstract" && start.end !== undefined) {
    return cursorLine > start.end ? null : { first: start.line, last: start.end };
  }
  return { first: start.line, last: next ? next.line - 1 : lines };
}

/** The lines a heading's limit is counted over: an abstract between its
 *  `\begin` and `\end`, and a section from its heading to the next one
 *  at its level or above, so its subsections count towards it. A section
 *  that runs to the end of the file ends at `lines`. */
export function limitSpan(
  outline: Heading[],
  index: number,
  lines: number,
): { first: number; last: number } {
  const heading = outline[index];
  if (heading.kind === "abstract" && heading.end !== undefined) {
    return { first: heading.line, last: heading.end };
  }
  for (let i = index + 1; i < outline.length; i++) {
    const next = outline[i];
    if (next.kind === "file") continue;
    if (next.kind === "abstract" || next.level <= heading.level) {
      return { first: heading.line, last: next.line - 1 };
    }
  }
  return { first: heading.line, last: lines };
}

/** Whether a row can carry a word limit: a heading or the abstract, not
 *  an included file, whose words are its own outline's business. */
export function limitable(heading: Heading): boolean {
  return heading.kind !== "file";
}

/** What a limited row says at its end. */
export function limitLabel(words: number | null, limit: number): string {
  const of = limit.toLocaleString();
  return words === null ? `\u2013 of ${of}` : `${words.toLocaleString()} of ${of}`;
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
