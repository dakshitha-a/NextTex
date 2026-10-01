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
