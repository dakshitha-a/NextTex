/** The links a page carries, and where an internal one goes.
 *
 *  hyperref writes every `\ref`, `\eqref`, `\cite` and contents entry as a
 *  link annotation on the page: a rectangle and either a destination in the
 *  document or an address outside it. The canvas draws none of that, so the
 *  pane lays a box over each rectangle (see `renderLinks` in Pdf.tsx) and
 *  these functions are the arithmetic it needs, kept apart so they can be
 *  tested without a document.
 *
 *  Every place here is in points from the page's top-left corner, upright,
 *  which is how SyncTeX, the text runs and the reveal's flash speak of the
 *  page. A document without hyperref has no annotations and so no links. */

import type { PageRun } from "./locate-on-page";

/** pdf.js's number for a link annotation, `AnnotationType.LINK`. */
const LINK = 2;

/** A box on the page: `y` is its bottom edge, as in SyncTeX's boxes. */
export type Box = { x: number; y: number; width: number; height: number };

export type PageLink = {
  box: Box;
  /** A named destination, `section.2` or `cite.knuth`, or pdf.js's
   *  explicit array; resolved only when the link is followed, since a page
   *  of contents carries a hundred of them. */
  dest?: string | unknown[];
  /** An address outside the document, `\url` or `\href`. */
  url?: string;
  /** A bibliography entry, by its citation key: the box opens its paper.
   *  See `entryLinks`. */
  paper?: string;
};

/** An address the preview will open: the web and mail, and nothing that
 *  runs (`javascript:`) or reaches the reader's disk (`file:`). */
function openable(url: unknown): url is string {
  return typeof url === "string" && /^(?:https?:|mailto:)/i.test(url);
}

/** The links among a page's annotations, from `page.getAnnotations()`.
 *  `view` is the page's `view`, its box in PDF space. */
export function linksOf(annotations: readonly unknown[], view: readonly number[]): PageLink[] {
  const [left, , , top] = view;
  const links: PageLink[] = [];
  for (const each of annotations) {
    const annotation = each as { annotationType?: number; rect?: number[]; dest?: unknown; url?: unknown };
    if (annotation.annotationType !== LINK || !annotation.rect) continue;
    const dest = typeof annotation.dest === "string" || Array.isArray(annotation.dest) ? annotation.dest : undefined;
    const url = openable(annotation.url) ? annotation.url : undefined;
    if (!dest && !url) continue;
    const [x1, y1, x2, y2] = annotation.rect;
    const box = {
      x: Math.min(x1, x2) - left,
      y: top - Math.min(y1, y2),
      width: Math.abs(x2 - x1),
      height: Math.abs(y2 - y1),
    };
    if (box.width <= 0 || box.height <= 0) continue;
    links.push(dest ? { box, dest } : { box, url });
  }
  return links;
}

/** How far down its page an explicit destination points, in points, or
 *  null for the top of the page.
 *
 *  hyperref's anchors are `XYZ`, a left and a top; `FitH` and `FitBH`
 *  name a top only. Any other kind fits the whole page, and the top of
 *  the page is where that is. A missing top is pdf.js's `null`. */
export function depthOf(explicit: readonly unknown[], view: readonly number[]): number | null {
  const kind = (explicit[1] as { name?: string } | undefined)?.name;
  const at = kind === "XYZ" ? explicit[3] : kind === "FitH" || kind === "FitBH" ? explicit[2] : null;
  if (typeof at !== "number" || !Number.isFinite(at)) return null;
  const top = view[3];
  const height = view[3] - view[1];
  return Math.min(Math.max(top - at, 0), height);
}

/** The line of type an anchor points at: the first line that starts at or
 *  below it, close enough to be what the anchor names.
 *
 *  hyperref puts a heading's anchor a line above the heading, and a
 *  citation's beside its entry, so the line just under the anchor is the
 *  thing the reader asked for. A figure's anchor sits over the figure and
 *  the next text may be its caption a picture's height away; past `reach`
 *  nothing is marked rather than the wrong line. */
export function lineBelow(runs: readonly PageRun[], depth: number, reach = 40): Box | null {
  let first: PageRun | null = null;
  for (const run of runs) {
    if (!run.str.trim() || run.top < depth - 2 || run.top > depth + reach) continue;
    if (!first || run.top < first.top) first = run;
  }
  if (!first) return null;
  const line = runs.filter((run) => run.str.trim() && Math.abs(run.bottom - first.bottom) < 1.5);
  const left = Math.min(...line.map((run) => run.left));
  const right = Math.max(...line.map((run) => run.left + run.width));
  const top = Math.min(...line.map((run) => run.top));
  const bottom = Math.max(...line.map((run) => run.bottom));
  return { x: left, y: bottom, width: right - left, height: bottom - top };
}

/** What a screen reader hears for a link, which has no text of its own:
 *  the box lies over the page's words, which are a picture. hyperref names
 *  its places for what they are, `section.2`, `cite.knuth`, `figure.1`,
 *  so the name says where the link goes. */
export function labelOf(link: PageLink): string {
  if (link.paper) return `Open the paper for ${link.paper}`;
  if (link.url) return link.url;
  if (typeof link.dest !== "string") return "Go to a place in the document";
  return `Go to ${link.dest.replace(/[._]+/g, " ").trim()}`;
}

/** The citation key a destination names, or null. hyperref names a
 *  bibliography entry's anchor `cite.knuth`, and biblatex `cite.0@knuth`,
 *  the number being the refsection. */
export function citeKey(name: string): string | null {
  const match = /^cite\.(?:\d+@)?(.+)$/.exec(name);
  return match ? match[1] : null;
}

/** An entry's anchor on its page: its key, its left edge and how far down
 *  it is, in points from the page's top-left corner. */
export type EntryAnchor = { key: string; x: number; depth: number };

/** More white space than this under an entry, in points, ends it. */
const GAP = 16;

/** A box over each bibliography entry on a page, from its anchor.
 *
 *  An anchor is a point, so the box is measured from the type: it runs
 *  from the anchor down to the next anchor in the same column, or to the
 *  last line under it in that column, and across the lines in between, so
 *  a hanging label such as "[12]" is inside it. Columns are told apart by
 *  the anchors' left edges; a two-column bibliography has two. */
export function entryLinks(anchors: readonly EntryAnchor[], runs: readonly PageRun[], width: number): PageLink[] {
  if (!anchors.length) return [];
  // The columns: anchors whose left edges are within 24 points of each
  // other are one column, parted half way between neighbours.
  const lefts = [...new Set(anchors.map((a) => Math.round(a.x)))].sort((a, b) => a - b);
  const columns: number[] = [];
  for (const left of lefts) {
    if (!columns.length || left - columns[columns.length - 1] > 24) columns.push(left);
  }
  const edges = columns.map((left, at) => [
    at === 0 ? 0 : (columns[at - 1] + left) / 2,
    at === columns.length - 1 ? width : (left + columns[at + 1]) / 2,
  ]);
  const columnOf = (x: number) => {
    const at = edges.findIndex(([from, to]) => x >= from - 1 && x < to);
    return at < 0 ? edges.length - 1 : at;
  };
  const links: PageLink[] = [];
  for (let column = 0; column < columns.length; column++) {
    const [from, to] = edges[column];
    const mine = anchors.filter((a) => columnOf(a.x) === column).sort((a, b) => a.depth - b.depth);
    const text = runs.filter((run) => run.str.trim() && run.left >= from - 1 && run.left < to);
    mine.forEach((anchor, at) => {
      const next = mine[at + 1]?.depth ?? Infinity;
      const under = text
        .filter((run) => run.top >= anchor.depth - 2 && run.top < next - 1)
        .sort((a, b) => a.top - b.top);
      // The entry ends where the type stops: past a gap of more than
      // `GAP` points, what follows is a page number or a footnote.
      const lines: PageRun[] = [];
      for (const run of under) {
        const last = lines.length ? Math.max(...lines.map((line) => line.bottom)) : null;
        if (last !== null && run.top - last > GAP) break;
        lines.push(run);
      }
      if (!lines.length) return;
      const left = Math.min(...lines.map((run) => run.left));
      const right = Math.max(...lines.map((run) => run.left + run.width));
      const top = Math.min(...lines.map((run) => run.top));
      const bottom = Math.max(...lines.map((run) => run.bottom));
      links.push({ box: { x: left, y: bottom, width: right - left, height: bottom - top }, paper: anchor.key });
    });
  }
  return links;
}
