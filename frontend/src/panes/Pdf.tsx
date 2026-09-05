import { useCallback, useEffect, useRef, useState } from "react";
import * as pdfjs from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import api from "../api";
import { get, useStore } from "../store";

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

/** Extra device pixels so text stays crisp without quadrupling the work. */
const RESOLUTION = Math.min(window.devicePixelRatio || 1, 2);

export type PdfHandle = {
  reveal(path: string, line: number): Promise<boolean>;
};

type PageView = {
  container: HTMLDivElement;
  canvas: HTMLCanvasElement;
  viewport: pdfjs.PageViewport;
  rendered: boolean;
  task: pdfjs.RenderTask | null;
};

export default function Pdf({
  onNavigate,
  handleRef,
}: {
  onNavigate: (file: string, line: number) => void;
  handleRef: (handle: PdfHandle) => void;
}) {
  const scroller = useRef<HTMLDivElement | null>(null);
  const sheet = useRef<HTMLDivElement | null>(null);
  const doc = useRef<pdfjs.PDFDocumentProxy | null>(null);
  const pages = useRef<PageView[]>([]);
  const observer = useRef<IntersectionObserver | null>(null);
  const [scale, setScale] = useState(1.25);
  const [pageCount, setPageCount] = useState(0);
  const [current, setCurrent] = useState(1);
  const [missing, setMissing] = useState(false);
  const stamp = useStore((s) => s.pdfStamp);
  const projectId = useStore((s) => s.projectId);

  /** Where the view is, in a form that survives the page count changing. */
  const anchor = useCallback(() => {
    const root = scroller.current;
    if (!root || !pages.current.length) return { index: 0, fraction: 0 };
    const top = root.scrollTop;
    for (let index = 0; index < pages.current.length; index += 1) {
      const element = pages.current[index].container;
      const start = element.offsetTop;
      const height = element.offsetHeight;
      if (top < start + height) {
        return { index, fraction: (top - start) / height };
      }
    }
    return { index: pages.current.length - 1, fraction: 0 };
  }, []);

  /** The page at the top of the view is the page the reader is on.  Taking
   *  it from the intersection observer instead reports whichever page most
   *  recently crossed the margin, which is usually the next one. */
  const trackCurrent = useCallback(() => {
    const position = anchorRef.current();
    setCurrent(position.index + 1);
  }, []);

  const restore = useCallback((position: { index: number; fraction: number }) => {
    const root = scroller.current;
    if (!root || !pages.current.length) return;
    const index = Math.min(position.index, pages.current.length - 1);
    const element = pages.current[index].container;
    root.scrollTop = element.offsetTop + position.fraction * element.offsetHeight;
  }, []);

  const anchorRef = useRef(anchor);
  anchorRef.current = anchor;

  const renderPage = useCallback(async (index: number) => {
    const view = pages.current[index];
    const document = doc.current;
    if (!view || !document || view.rendered || view.task) return;
    const page = await document.getPage(index + 1);
    const viewport = page.getViewport({ scale: scale * RESOLUTION });
    const canvas = view.canvas;
    canvas.width = Math.floor(viewport.width);
    canvas.height = Math.floor(viewport.height);
    const context = canvas.getContext("2d");
    if (!context) return;
    view.task = page.render({ canvasContext: context, viewport } as any);
    try {
      await view.task.promise;
      view.rendered = true;
    } catch {
      /* superseded by a re-render; the next pass will draw it */
    } finally {
      view.task = null;
    }
  }, [scale]);

  const build = useCallback(
    async (document: pdfjs.PDFDocumentProxy, keep: boolean) => {
      const position = keep ? anchor() : { index: 0, fraction: 0 };
      const container = sheet.current;
      if (!container) return;

      observer.current?.disconnect();
      for (const view of pages.current) view.task?.cancel();

      // Every page's height is known before anything is drawn, so the
      // scrollbar is correct from the first frame and the restored position
      // does not slide as pages arrive.
      const built: PageView[] = [];
      const fragment = document.numPages;
      const first = await document.getPage(1);
      const base = first.getViewport({ scale });
      for (let index = 0; index < fragment; index += 1) {
        const element = window.document.createElement("div");
        element.className = "nx-page";
        element.style.width = `${Math.floor(base.width)}px`;
        element.style.height = `${Math.floor(base.height)}px`;
        const canvas = window.document.createElement("canvas");
        canvas.style.width = "100%";
        canvas.style.height = "100%";
        canvas.style.display = "block";
        element.appendChild(canvas);
        built.push({ container: element, canvas, viewport: base, rendered: false, task: null });
      }
      // Per-page viewports, in case the document mixes page sizes.
      await Promise.all(
        built.map(async (view, index) => {
          if (index === 0) return;
          const page = await document.getPage(index + 1);
          const viewport = page.getViewport({ scale });
          view.viewport = viewport;
          view.container.style.width = `${Math.floor(viewport.width)}px`;
          view.container.style.height = `${Math.floor(viewport.height)}px`;
        }),
      );

      // Swap the whole set in one frame: the pane is never blanked.
      const next = window.document.createDocumentFragment();
      for (const view of built) next.appendChild(view.container);
      container.replaceChildren(next);
      pages.current = built;
      setPageCount(fragment);
      restore(position);

      observer.current = new IntersectionObserver(
        (entries) => {
          for (const entry of entries) {
            const index = built.findIndex((view) => view.container === entry.target);
            if (index < 0) continue;
            if (entry.isIntersecting) {
              renderPage(index);
              renderPage(index + 1);
              renderPage(index - 1);
            }
          }
        },
        { root: scroller.current, rootMargin: "200px 0px" },
      );
      for (const view of built) observer.current.observe(view.container);
      await renderPage(Math.min(position.index, built.length - 1));
      trackCurrent();
    },
    [anchor, renderPage, restore, scale, trackCurrent],
  );

  // Load, and reload after every build.
  useEffect(() => {
    if (!projectId) return;
    let cancelled = false;
    (async () => {
      try {
        const response = await fetch(api.pdfUrl(projectId, stamp), {
          credentials: "same-origin",
        });
        if (!response.ok) {
          setMissing(true);
          return;
        }
        const data = await response.arrayBuffer();
        if (cancelled) return;
        const loaded = await pdfjs.getDocument({ data }).promise;
        if (cancelled) {
          loaded.destroy();
          return;
        }
        const previous = doc.current;
        doc.current = loaded;
        setMissing(false);
        await build(loaded, previous !== null);
        previous?.destroy();
      } catch {
        setMissing(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [projectId, stamp, build]);

  // Re-render at a new zoom without losing the reader's place.
  useEffect(() => {
    if (doc.current) build(doc.current, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scale]);

  /** Double-click anywhere on the page goes to that line of the source. */
  const onDoubleClick = useCallback(
    async (event: React.MouseEvent) => {
      const projectId = get().projectId;
      if (!projectId) return;
      const target = (event.target as HTMLElement).closest(".nx-page");
      if (!target) return;
      const index = pages.current.findIndex((view) => view.container === target);
      if (index < 0) return;
      const box = target.getBoundingClientRect();
      // SyncTeX works in PDF points from the top-left corner, and so does the
      // canvas, so the conversion is the scale factor and nothing else.
      const x = (event.clientX - box.left) / scale;
      const y = (event.clientY - box.top) / scale;
      try {
        const result = await api.inverse(projectId, index + 1, x, y);
        if (result.found && result.file && result.line) {
          onNavigate(result.file, result.line);
        }
      } catch {
        /* a click that lands on nothing is not an error worth reporting */
      }
    },
    [onNavigate, scale],
  );

  // Forward search: from a source line to the page.
  useEffect(() => {
    handleRef({
      reveal: async (path: string, line: number) => {
        const projectId = get().projectId;
        if (!projectId) return false;
        try {
          const result = await api.forward(projectId, path, line);
          const position = result.positions?.[0];
          if (!position) return false;
          const view = pages.current[position.page - 1];
          const root = scroller.current;
          if (!view || !root) return false;
          const top =
            view.container.offsetTop +
            (position.y - position.height) * scale -
            root.clientHeight / 3;
          root.scrollTo({ top: Math.max(top, 0) });
          const flash = window.document.createElement("div");
          flash.className = "nx-flash";
          flash.style.left = `${position.x * scale}px`;
          flash.style.top = `${(position.y - position.height) * scale}px`;
          flash.style.width = `${Math.max(position.width * scale, 12)}px`;
          flash.style.height = `${Math.max(position.height * scale, 10)}px`;
          view.container.appendChild(flash);
          window.setTimeout(() => flash.remove(), 700);
          return true;
        } catch {
          return false;
        }
      },
    });
  }, [handleRef, scale]);

  return (
    <div className="flex h-full min-h-0 flex-col bg-surround">
      <div
        ref={scroller}
        className="min-h-0 flex-1 overflow-auto"
        onScroll={trackCurrent}
        onDoubleClick={onDoubleClick}
      >
        {missing ? (
          <div className="flex h-full items-center justify-center px-8 text-center">
            <p className="t-meta text-ink-3 max-w-[32ch]">
              Nothing has been typeset yet. Save a change, or press the rebuild
              control in the status strip.
            </p>
          </div>
        ) : null}
        <div ref={sheet} className="flex flex-col items-center gap-4 py-4" />
      </div>
      <div className="flex h-[26px] shrink-0 items-center gap-3 border-t border-line bg-surface-2 px-[10px]">
        <span className="t-micro text-ink-2 tnum">
          {pageCount ? `Page ${current} of ${pageCount}` : "—"}
        </span>
        <span className="h-[10px] w-px bg-line" />
        <button
          className="t-micro text-ink-2 hover:text-ink"
          onClick={() => setScale((value) => Math.max(0.5, +(value - 0.15).toFixed(2)))}
          title="Zoom out"
        >
          −
        </button>
        <span className="t-micro text-ink-3 tnum w-[34px] text-center">
          {Math.round(scale * 100)}%
        </span>
        <button
          className="t-micro text-ink-2 hover:text-ink"
          onClick={() => setScale((value) => Math.min(3, +(value + 0.15).toFixed(2)))}
          title="Zoom in"
        >
          +
        </button>
        <span className="h-[10px] w-px bg-line" />
        <button
          className="t-micro text-ink-2 hover:text-ink"
          onClick={() => {
            const root = scroller.current;
            const page = pages.current[0];
            if (root && page) {
              setScale((value) =>
                +(
                  ((root.clientWidth - 48) / (page.viewport.width / value))
                ).toFixed(2),
              );
            }
          }}
        >
          Fit width
        </button>
      </div>
    </div>
  );
}
