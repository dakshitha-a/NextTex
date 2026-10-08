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

/** Never opened in the editor, said from the name alone.  The server's
 *  `BINARY_SUFFIXES` in `nexttex/project.py`, which the vitest beside this
 *  file holds this to.  Any other name is text until the server, which has
 *  the bytes, says otherwise: it reads the head of every file whose name
 *  it does not know, and `learnKinds` hands its answers to this module. */
const BINARY = new Set([
  ".zip", ".gz", ".tgz", ".bz2", ".xz", ".zst", ".7z", ".rar", ".tar",
  ".docx", ".doc", ".xlsx", ".xls", ".pptx", ".ppt", ".odt", ".ods", ".odp",
  ".npy", ".npz", ".h5", ".hdf5", ".nc", ".pkl", ".pickle", ".parquet",
  ".feather", ".mat", ".sqlite", ".db",
  ".pyc", ".o", ".so", ".a", ".dll", ".dylib", ".exe", ".class", ".wasm", ".bin",
  ".tif", ".tiff", ".bmp", ".heic", ".heif", ".avif", ".ico",
  ".mp3", ".mp4", ".wav", ".mov", ".avi", ".ogg", ".webm",
  ".ttf", ".otf", ".woff", ".woff2", ".dvi", ".xdv",
  ".chk", ".gbw", ".rwf", ".trr", ".xtc", ".dcd", ".tpr", ".edr", ".cpt",
  // Not the server's: it calls PostScript an image, for LaTeX's sake, and
  // nothing here can draw one.
  ".eps",
]);

/** Text that is prose, which the spell checker reads.  Every other text file is code, or a program's input or
 *  output, and is spared both: a `.xyz` is a column of coordinates and a
 *  Fortran source is identifiers, and red underlines under either say
 *  nothing about their spelling.  A name with no extension is prose, the
 *  README it usually is, rather than the Makefile it sometimes is. */
const PROSE = new Set([
  "", ".tex", ".ltx", ".sty", ".cls", ".bib", ".bst", ".bbl", ".txt",
  ".md", ".markdown",
]);

/** The prose the editor draws in LaTeX's mode: TeX, its packages and
 *  classes, and the bibliography with what BibTeX writes from it.  A
 *  Markdown file has its own mode, and a `.txt` or a README none. */
const TEX_FAMILY = new Set([".tex", ".ltx", ".sty", ".cls", ".bib", ".bst", ".bbl"]);

/** What the server said about each file in the tree, by path.  The tree is
 *  the only place the bytes speak, so a `.out` that is really a binary is
 *  known as one here once the tree has been read, and before then is text,
 *  which is what the name alone would say. */
let heard = new Map<string, string>();

/** Take the server's kinds from a project tree.  Called whenever the store
 *  holds a new one; a tree is the whole project, so it replaces what was
 *  heard rather than adding to it. */
export function learnKinds(tree: unknown): void {
  const next = new Map<string, string>();
  const walk = (node: any) => {
    if (!node) return;
    if (node.type === "file" && typeof node.path === "string" && node.kind) {
      next.set(node.path, node.kind);
    }
    for (const child of node.children ?? []) walk(child);
  };
  walk(tree);
  heard = next;
}

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
  if (BINARY.has(extension) || heard.get(path) === "binary") return "other";
  // Anything else is text: a README with no extension, a program's input,
  // a molecule, a source file in any language. Being wrong this way costs
  // a refusal the server words plainly; being wrong the other way cost the
  // writer every file whose suffix nobody had thought to list.
  return "text";
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

/** The largest text file with a shared document behind it, and so the
 *  largest the editor edits: `MAX_TEXT_BYTES` in `server/collab/store.py`.
 *  A larger one is a blob there, and an editor bound to it showed an empty
 *  page marked offline that kept nothing typed into it. */
export const EDITABLE_TEXT_BYTES = 2 * 1024 * 1024;

/** The largest text file the file route hands over at all, for reading:
 *  `MAX_TEXT_BYTES` in `server/main.py`. A program's output past this is
 *  offered as a download. */
export const READABLE_TEXT_BYTES = 10 * 1024 * 1024;

export function isCode(path: string): boolean {
  return isText(path) && !PROSE.has(extensionOf(path));
}

export function isTeXFamily(path: string): boolean {
  return TEX_FAMILY.has(extensionOf(path));
}

/** A Python script, which is the one kind of file the editor can run. */
export function isScript(path: string): boolean {
  return extensionOf(path) === ".py";
}

/** A Markdown file, which the preview pane renders as it is typed. */
export function isMarkdown(path: string): boolean {
  const extension = extensionOf(path);
  return extension === ".md" || extension === ".markdown";
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
  | "script"
  | "slides"
  | "file";

/** A picture the browser cannot draw but a row should still call one. */
const PICTURE = new Set([".tif", ".tiff", ".bmp", ".heic", ".heif"]);

export function iconFor(path: string): IconName {
  const extension = extensionOf(path);
  if (isTeX(path)) return "tex";
  if (extension === ".bib" || extension === ".bst" || extension === ".bbl") return "bib";
  if (extension === ".sty" || extension === ".cls") return "style";
  if (kindOf(path) === "image" || PICTURE.has(extension)) return "image";
  // Office files take the glyph of what is inside them: a workbook is a
  // table, a Word document is prose, and a deck is the one landscape
  // shape in the set.
  if (extension === ".xlsx" || extension === ".xls" || extension === ".ods") return "data";
  if (extension === ".docx" || extension === ".doc" || extension === ".odt") return "tex";
  if (extension === ".pptx" || extension === ".ppt" || extension === ".odp") return "slides";
  if (kindOf(path) === "pdf") return "pdf";
  if (extension === ".py" || extension === ".sh") return "script";
  if (
    extension === ".csv" || extension === ".tsv" || extension === ".json" ||
    extension === ".toml" || extension === ".yml" || extension === ".yaml"
  ) {
    return "data";
  }
  return "file";
}

/** The drag type a file-tree row carries: its project path, and nothing a
 *  page elsewhere would take as a file. The tree moves rows with it and
 *  the Claude composer takes it as a file to point the agent at. */
export const NX_PATH = "application/x-nexttex-path";

/** What can go with a question to the agent, by suffix: documents,
 *  pictures and text. The server keeps the same list in
 *  `nexttex/attachments.py`, which is the one that refuses; this one only
 *  decides what the composer tries to send, and the vitest beside this
 *  file holds the two together. */
export const ATTACHABLE = new Set([
  ".pdf", ".docx", ".xlsx", ".pptx",
  ".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".tif", ".tiff",
  ".bmp", ".heic", ".heif", ".avif",
  ".md", ".markdown", ".txt", ".py", ".r", ".m", ".tex", ".bib", ".csv",
  ".tsv", ".json", ".yml", ".yaml", ".toml", ".dat",
]);

export function isAttachable(name: string): boolean {
  return ATTACHABLE.has(extensionOf(name));
}

/** Whether a chip can show this attachment as a thumbnail: a picture the
 *  browser draws. A TIFF or a HEIC gets the picture glyph instead. */
export function hasThumbnail(name: string): boolean {
  return IMAGE.has(extensionOf(name));
}
