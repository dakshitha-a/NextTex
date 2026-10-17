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
  if (link.url) return link.url;
  if (typeof link.dest !== "string") return "Go to a place in the document";
  return `Go to ${link.dest.replace(/[._]+/g, " ").trim()}`;
}
