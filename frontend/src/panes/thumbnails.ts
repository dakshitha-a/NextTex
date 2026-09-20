import api from "../api";

/** A small picture of a file the editor cannot edit.
 *
 *  One service for the two places that show one: the card that opens
 *  beside a tree row for an image, a PDF used as a figure or another
 *  binary, and the hover on `\includegraphics` in the editor. A raster or
 *  an SVG is the file itself, drawn by the browser from the same route the
 *  figure view reads; a PDF is its first page, drawn once by the pdf.js the
 *  preview already loads, at twice the card's width so it is sharp on a
 *  dense screen. Anything else has no picture, and the card shows the
 *  name and the size alone.
 *
 *  Cached per path and modification time, so a plot that is regenerated
 *  every minute is redrawn and one that is not is drawn once; the promise
 *  is what is cached, so two hovers in quick succession render one page,
 *  not two. The cache is bounded, since a figures folder can hold a
 *  thousand files and a session can hover most of them.
 *
 *  This module lives in the card's chunk, not the entry: pdf.js is
 *  imported when a PDF is first hovered and never before, and the worker
 *  is named here as well because `Pdf.tsx` names it at module load and
 *  may not have loaded yet.
 */

export type Thumbnail = {
  /** What to put in an `<img>`, or null for a file with no picture. */
  url: string | null;
  /** The picture's own size: pixels for a raster, points for a page;
   *  zero when the file does not say (an SVG without a viewBox). */
  width: number;
  height: number;
  /** The unit those two are in. */
  unit: "px" | "pt";
};

const RASTER = new Set(["png", "jpg", "jpeg", "gif", "webp", "svg"]);
const CACHE_LIMIT = 64;
const cache = new Map<string, Promise<Thumbnail>>();

const NONE: Thumbnail = { url: null, width: 0, height: 0, unit: "px" };

function extensionOf(path: string): string {
  const name = path.split("/").pop() ?? "";
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : "";
}

/** Whether a hover on this file would show a picture at all. */
export function hasThumbnail(path: string): boolean {
  const extension = extensionOf(path);
  return RASTER.has(extension) || extension === "pdf";
}

/** The picture for a project file, or the answer that there is none. */
export function thumbnail(projectId: string, path: string, stamp: number): Promise<Thumbnail> {
  const key = `${projectId}:${path}:${stamp}`;
  const held = cache.get(key);
  if (held) return held;
  const made = make(projectId, path).catch(() => NONE);
  cache.set(key, made);
  // The oldest goes first: a Map iterates in insertion order.
  if (cache.size > CACHE_LIMIT) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  return made;
}

async function make(projectId: string, path: string): Promise<Thumbnail> {
  const extension = extensionOf(path);
  const url = api.downloadUrl(projectId, { path });
  if (RASTER.has(extension)) return raster(url);
  if (extension === "pdf") return firstPage(url);
  return NONE;
}

function raster(url: string): Promise<Thumbnail> {
  return new Promise((resolve, reject) => {
    const picture = new Image();
    picture.onload = () =>
      resolve({ url, width: picture.naturalWidth, height: picture.naturalHeight, unit: "px" });
    picture.onerror = () => reject(new Error("could not load the image"));
    picture.src = url;
  });
}

/** The first page of a PDF, drawn to a canvas 464 px wide. */
async function firstPage(url: string): Promise<Thumbnail> {
  const [pdfjs, worker] = await Promise.all([
    import("pdfjs-dist"),
    import("pdfjs-dist/build/pdf.worker.min.mjs?url"),
  ]);
  if (!pdfjs.GlobalWorkerOptions.workerSrc) pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
  const answer = await fetch(url, { credentials: "same-origin" });
  if (!answer.ok) throw new Error(`the file answered ${answer.status}`);
  const data = await answer.arrayBuffer();
  const doc = await pdfjs.getDocument({ data }).promise;
  try {
    const page = await doc.getPage(1);
    const natural = page.getViewport({ scale: 1 });
    const scale = 464 / natural.width;
    const viewport = page.getViewport({ scale });
    const canvas = document.createElement("canvas");
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    const context = canvas.getContext("2d");
    if (!context) throw new Error("no canvas");
    await page.render({ canvasContext: context, viewport }).promise;
    return {
      url: canvas.toDataURL("image/png"),
      width: Math.round(natural.width),
      height: Math.round(natural.height),
      unit: "pt",
    };
  } finally {
    void doc.destroy();
  }
}
