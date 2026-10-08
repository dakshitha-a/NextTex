import { diffArrays } from "diff";

/** Where a line of the source the PDF was built from is now.
 *
 *  SyncTeX answers a double-click with a line of the source as it stood
 *  when the PDF on screen was built. Writing goes on while that PDF is up,
 *  so fifty lines added above a paragraph sent the jump fifty lines short,
 *  outside the forty the word search looks through, and it found nothing.
 *
 *  So the editor keeps the text of every open file as it stood when a
 *  build started, and when that build's PDF arrives the snapshot becomes
 *  the one the page on screen was built from. A line synctex names is
 *  carried from that text to the text in the editor now. A build whose
 *  PDF did not arrive, cancelled or kept from before, leaves the page's
 *  snapshot as it was.
 *
 *  The snapshot is taken when the server says a build started, a moment
 *  before it reads the files, so a keystroke in that moment is counted as
 *  after the build. That moves a line by the keystroke at most, and the
 *  word search either side of the line puts it right.
 */
export class BuildLines {
  private pending = new Map<string, string>();
  private shown = new Map<string, string>();

  /** A build started: these are the files as they stand. */
  started(texts: Map<string, string>): void {
    this.pending = texts;
  }

  /** A build finished. Its PDF is the one on screen unless the build kept
   *  the last one that worked. */
  finished(kept: boolean): void {
    if (!kept) this.shown = this.pending;
  }

  /** The text the PDF on screen was built from, when it is known. */
  builtText(path: string): string | undefined {
    return this.shown.get(path);
  }

  /** `line` of the built text, as a line of `now`. */
  map(path: string, line: number, now: string): number {
    const built = this.shown.get(path);
    return built === undefined ? line : mapLine(built, now, line);
  }
}

/** Above this many changed lines on each side the diff is not worth its
 *  cost, and the line is placed in proportion instead. */
const DIFF_LIMIT = 4000;

/** `line` of `before`, 1-based, as a line of `after`.
 *
 *  A line that was changed in place maps to its own place; a line that
 *  was deleted maps to where it stood, the line after the lines before it.
 */
export function mapLine(before: string, after: string, line: number): number {
  if (before === after) return line;
  const a = before.split("\n");
  const b = after.split("\n");
  const index = Math.min(Math.max(line, 1), a.length) - 1;
  // The lines the two share at the top and at the bottom, which is all of
  // them but an edit's own, and all the search needs for most lines.
  let top = 0;
  while (top < a.length && top < b.length && a[top] === b[top]) top += 1;
  if (index < top) return index + 1;
  let bottom = 0;
  while (
    bottom < a.length - top && bottom < b.length - top
    && a[a.length - 1 - bottom] === b[b.length - 1 - bottom]
  ) bottom += 1;
  if (index >= a.length - bottom) return index - a.length + b.length + 1;
  const middleA = a.slice(top, a.length - bottom);
  const middleB = b.slice(top, b.length - bottom);
  const at = index - top;
  if (middleA.length > DIFF_LIMIT || middleB.length > DIFF_LIMIT) {
    return top + Math.round((at / Math.max(middleA.length, 1)) * middleB.length) + 1;
  }
  // Walk the diff of the middle, counting lines on both sides, until the
  // line is reached.
  let ia = 0;
  let ib = 0;
  const parts = diffArrays(middleA, middleB);
  for (let k = 0; k < parts.length; k += 1) {
    const part = parts[k];
    const count = part.count ?? part.value.length;
    if (part.removed) {
      if (at < ia + count) {
        // Replaced rather than deleted: a removal followed by an addition
        // is the same lines rewritten, and the line keeps its offset into
        // them while there are enough.
        const next = parts[k + 1];
        const added = next?.added ? (next.count ?? next.value.length) : 0;
        return top + ib + Math.min(at - ia, Math.max(added - 1, 0)) + 1;
      }
      ia += count;
    } else if (part.added) {
      ib += count;
    } else {
      if (at < ia + count) return top + ib + (at - ia) + 1;
      ia += count;
      ib += count;
    }
  }
  return top + ib + 1;
}
