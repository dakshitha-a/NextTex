/** One pdf.js worker for the page, kept for as long as the page lives.
 *
 *  `getDocument` with no worker makes one of its own and the document's
 *  destruction takes it away again, so every rebuild of the preview
 *  started a new Web Worker and compiled pdf.js's 1.3 MB worker script
 *  afresh before it could read a byte of the new PDF: seven workers in a
 *  session of six rebuilds. A worker handed in is the caller's, and
 *  destroying a document leaves it running for the next one. The
 *  preview and the projects screen's thumbnails share it.
 */
import * as pdfjs from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

let shared: pdfjs.PDFWorker | null = null;

export function pdfWorker(): pdfjs.PDFWorker {
  if (!pdfjs.GlobalWorkerOptions.workerSrc) pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
  if (!shared || shared.destroyed) shared = new pdfjs.PDFWorker();
  return shared;
}

/** Where pdf.js finds what it fetches as it needs it: the WebAssembly
 *  that decodes CCITT, JBIG2 and JPEG 2000 images and applies ICC colour
 *  profiles, the character maps of CJK fonts a PDF does not embed, and
 *  the fourteen standard fonts. Given none of these, pdf.js 6 drew a
 *  scanned book as blank pages and left a journal's JPEG 2000 figures
 *  out, with only a warning in the console. The build copies the four
 *  directories from `pdfjs-dist` into `assets/pdfjs/` (`vite.config.ts`);
 *  the development server serves them from `node_modules` as they are.
 */
const DATA = import.meta.env.DEV ? "/node_modules/pdfjs-dist/" : "/assets/pdfjs/";

/** What `getDocument` is given for a PDF's bytes, the same for every
 *  caller so the preview and the thumbnails cannot draw a file
 *  differently. */
export function pdfSource(data: ArrayBuffer): Parameters<typeof pdfjs.getDocument>[0] {
  const at = (folder: string) => new URL(`${DATA}${folder}/`, location.origin).href;
  return {
    data,
    worker: pdfWorker(),
    wasmUrl: at("wasm"),
    cMapUrl: at("cmaps"),
    cMapPacked: true,
    standardFontDataUrl: at("standard_fonts"),
    iccUrl: at("iccs"),
  };
}
