/** What kind of thing a file is, asked in one place.
 *
 *  There were four answers to this question and they disagreed.  The server
 *  has TEXT_SUFFIXES and IMAGE_SUFFIXES in `nexttex/project.py`; this
 *  directory had a RENDERABLE set that excluded `.pdf`; `History.tsx` had a
 *  second TEXT_SUFFIXES of its own that included `.bbl`, `.csv`, `.log`,
 *  `.py` and `.sh` where the server's did not; and the file tree asked
 *  about `.bib` and `.tex` with regular expressions written inline.  The
 *  visible consequence was that a PDF figure in the file tree was called an
 *  image by the server, refused by the renderer, and offered as a download
 *  in a viewer that had PDF.js loaded a pane away.
 *
 *  The server's sets are deliberately *not* merged into this.  Those decide
 *  what the editor may open, which is a question about bytes on disk and
 *  has to be answered on the server whatever the browser believes.  These
 *  decide how to draw a row and which viewer to reach for.  Two questions,
 *  two answers, one of them here.
 *
 *  No imports, and none may be added.  `History.tsx` imports this
 *  statically, and a static import anywhere keeps the whole module in the
 *  entry chunk -- which is what stopped `FileView` being split out of it
 *  before.  A React import here would drag both viewers back into the first
 *  paint.
 */

/** Drawn by the browser from a plain `<img>`. */
const IMAGE = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".avif"]);

/** Drawn by PDF.js, which the preview pane already carries. */
const PDF = new Set([".pdf"]);

/** Opened in the editor.  A superset of the server's list rather than a
 *  copy of it: a file the server will hand over as text and this set did
 *  not know about would be shown as an unopenable binary, so the vitest
 *  beside this file asserts the containment rather than the equality. */
const TEXT = new Set([
  ".tex", ".ltx", ".sty", ".cls", ".bib", ".bst", ".bbl", ".txt", ".md",
  ".json", ".yml", ".yaml", ".csv", ".tsv", ".toml", ".cfg", ".ini", ".log",
  ".py", ".sh", ".r", ".m", ".gitignore", ".gitattributes", ".env",
]);

export type FileKind = "text" | "image" | "pdf" | "other";

export function extensionOf(path: string): string {
  const name = path.slice(path.lastIndexOf("/") + 1);
  const dot = name.lastIndexOf(".");
  // A leading dot is a whole name, not an extension: `.gitignore` is the
  // file, and slicing at 0 would call every dotfile an extension of itself.
  return dot > 0 ? name.slice(dot).toLowerCase() : "";
}

export function kindOf(path: string): FileKind {
  const extension = extensionOf(path);
  if (IMAGE.has(extension)) return "image";
  if (PDF.has(extension)) return "pdf";
  // No extension means a README or a LICENSE far more often than it means
  // a binary, and being wrong the other way costs the writer a file they
  // cannot open.
  if (!extension || TEXT.has(extension)) return "text";
  return "other";
}

/** Whether an `<img>` will simply draw it.  Kept under its original name
 *  because two panes ask for it by that name and it still means what it
 *  said: PDFs are viewable but not renderable, and the distinction is the
 *  whole reason they were being refused. */
export function isRenderable(path: string): boolean {
  return kindOf(path) === "image";
}

/** Whether the app can show it at all, rather than offering a download. */
export function isViewable(path: string): boolean {
  const kind = kindOf(path);
  return kind === "image" || kind === "pdf";
}

export function isText(path: string): boolean {
  return kindOf(path) === "text";
}

export function isBib(path: string): boolean {
  return extensionOf(path) === ".bib";
}

/** Whether this is a file somebody would plot.
 *
 *  Named for the question rather than for a format, because that is what
 *  the caller is asking: the file-tree row offers "Plot this" on these and
 *  on nothing else, and an item that explains itself by failing is worse
 *  than no item.
 *
 *  `.dat` and `.txt` are in and `.log` is not, which is the one judgement
 *  call here: a `.txt` beside a thesis is usually columns of numbers, and a
 *  `.log` is always a build.
 */
const DATA = new Set([
  ".csv", ".tsv", ".dat", ".txt", ".json", ".parquet",
  ".xlsx", ".xls", ".ods", ".h5", ".hdf5", ".npy", ".npz",
]);

export function isData(path: string): boolean {
  return DATA.has(extensionOf(path));
}

export function isTeX(path: string): boolean {
  const extension = extensionOf(path);
  return extension === ".tex" || extension === ".ltx";
}

/** Which glyph a row draws.  A name rather than a component, so this file
 *  stays free of React for the reason in the header. */
export type IconName =
  | "folder"
  | "tex"
  | "bib"
  | "image"
  | "pdf"
  | "style"
  | "data"
  | "file";

export function iconFor(path: string): IconName {
  const extension = extensionOf(path);
  if (isTeX(path)) return "tex";
  if (extension === ".bib" || extension === ".bst" || extension === ".bbl") return "bib";
  if (extension === ".sty" || extension === ".cls") return "style";
  if (kindOf(path) === "image") return "image";
  if (kindOf(path) === "pdf") return "pdf";
  if (
    extension === ".csv" || extension === ".tsv" || extension === ".json" ||
    extension === ".toml" || extension === ".yml" || extension === ".yaml"
  ) {
    return "data";
  }
  return "file";
}
