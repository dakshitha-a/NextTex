import type { IconName } from "./file-kinds";

/** The file tree's glyphs.
 *
 *  Drawn rather than fetched, like the cog and the share mark in
 *  `chrome.tsx`, so the interface still carries no icon font and no sprite
 *  sheet.  Every attribute is quoted: an unquoted one ending in a slash
 *  swallows the tag's own close and the path draws nothing, which has
 *  happened in this codebase before.
 *
 *  Two rules hold the set together.
 *
 *  **Nothing here is coloured.**  Every glyph strokes `currentColor`, so it
 *  takes the row's own ink and dims with it.  A file tree in seven hues
 *  would put more saturated colour on screen than the rest of the app owns
 *  put together, and violet in this application means one thing only: the
 *  agent touched this.  A tree that colour-codes by extension is also a
 *  tree you have to learn; a tree of grey marks is one you can read.
 *
 *  **The folder is louder than the files.**  A folder is the thing you act
 *  on -- open it, drop into it, put a new file in it -- and it is the only
 *  glyph drawn at full ink.  File marks sit at the tertiary ink beside a
 *  name that is already telling you the extension, so they are a second,
 *  faster reading of something the row was saying anyway rather than a new
 *  thing to decode.
 *
 *  They are drawn on a 16 unit grid and shown at 14, which is the size the
 *  interior marks were checked at.  Below about 11 the two lines inside a
 *  document close up into a smudge; there is nothing here that needs to go
 *  that small.
 */

const STROKE = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.3,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

/** The document silhouette every file glyph is built on: a sheet with the
 *  corner turned down, which is what a page has looked like since long
 *  before there were file managers to draw it. */
function Sheet({ children }: { children?: React.ReactNode }) {
  return (
    <>
      <path d="M3.75 2.4h5.1l3.4 3.4v7.8H3.75z" />
      <path d="M8.85 2.4v3.4h3.4" />
      {children}
    </>
  );
}

export function FolderIcon({ open }: { open: boolean }) {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
      <g {...STROKE}>
        {open ? (
          // Open: the back of the folder stays put and the front panel
          // leans away from it. The lean is what carries the state at this
          // size -- a chevron already says open, and a second chevron drawn
          // as a folder would say it twice.
          <>
            <path d="M2 12.8V3.8h3.9l1.35 1.6H13v1.8" />
            <path d="M3.55 12.8h9.4l1.6-4.9H5.15z" />
          </>
        ) : (
          <path d="M2 12.8V3.8h3.9l1.35 1.6H14v7.4z" />
        )}
      </g>
    </svg>
  );
}

/** A word of caution for anyone adding to this: the marks have to differ in
 *  *shape*, not in count. Two lines against three lines is not a difference
 *  you can see in a moving list. */
function Mark({ name }: { name: IconName }) {
  switch (name) {
    case "tex":
      // A page with prose on it, and a rule under the first line: a heading
      // and its paragraph, which is what a .tex file is.
      return (
        <Sheet>
          <path d="M5.6 8.2h4.4" />
          <path d="M5.6 10.5h4.4" />
          <path d="M5.6 12h2.6" />
        </Sheet>
      );
    case "bib":
      // A reference list: each line led by its marker.
      return (
        <Sheet>
          <path d="M5.6 8.4h0.01" />
          <path d="M7.2 8.4h2.8" />
          <path d="M5.6 10.7h0.01" />
          <path d="M7.2 10.7h2.8" />
        </Sheet>
      );
    case "style":
      // A page that is rules rather than prose: a brace, because that is
      // what is inside a .sty and nothing else in the tree looks like one.
      return (
        <Sheet>
          <path d="M7.4 7.9c-1 0-1 1.1-1 1.8s0 1.8-1 1.8c1 0 1 1.1 1 1.8" />
        </Sheet>
      );
    case "data":
      // A table, which is what a .csv is and what a .json usually becomes.
      return (
        <Sheet>
          <path d="M5.5 8.6h5" />
          <path d="M5.5 11h5" />
          <path d="M8 8.6v4.2" />
        </Sheet>
      );
    case "pdf":
      // The one glyph that is not a sheet with marks on it, because a PDF
      // in this application is not a source file: it is a typeset page, and
      // it is what the whole app exists to produce. So it is drawn as a
      // page with a printed block on it.
      return (
        <Sheet>
          <path d="M5.6 8.3h4.6" />
          <rect x="5.6" y="10" width="4.6" height="2.6" rx="0.3" fill="currentColor" stroke="none" />
        </Sheet>
      );
    case "image":
      // A framed picture: horizon and sun. The most conventional glyph in
      // the set, deliberately -- this one has meant "picture" for forty
      // years and there is nothing to gain by being clever about it.
      return (
        <>
          <rect x="2.4" y="3.4" width="11.2" height="9.2" rx="1" />
          <circle cx="5.8" cy="6.6" r="1.05" />
          <path d="M2.4 11.1l3.1-2.9 2.5 2.2 2.4-2.7 3.2 3.4" />
        </>
      );
    default:
      return <Sheet />;
  }
}

export function FileIcon({ name }: { name: IconName }) {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
      <g {...STROKE}>
        <Mark name={name} />
      </g>
    </svg>
  );
}
