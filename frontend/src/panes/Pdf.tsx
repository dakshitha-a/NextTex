import { useCallback, useEffect, useRef, useState } from "react";
import * as pdfjs from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import api from "../api";
import { get, useStore } from "../store";

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

/** Extra device pixels so text stays crisp without quadrupling the work. */
const RESOLUTION = Math.min(window.devicePixelRatio || 1, 2);

/** How far outside the viewport a page is still worth drawing. */
const NEAR = 400;

export type PdfHandle = {
  reveal(path: string, line: number): Promise<boolean>;
};

type Mode = "scroll" | "page";

type PageView = {
  container: HTMLDivElement;
  canvas: HTMLCanvasElement;
  width: number;
  height: number;
  scale: number;
  /** The document generation this canvas was drawn from. */
  drawnFor: number;
  task: pdfjs.RenderTask | null;
};

export default function Pdf({
  onNavigate,
  onLoadTemplate,
  handleRef,
}: {
  onNavigate: (file: string, line: number) => void;
  onLoadTemplate?: () => void;
  handleRef: (handle: PdfHandle) => void;
}) {
  const scroller = useRef<HTMLDivElement | null>(null);
  const sheet = useRef<HTMLDivElement | null>(null);
  const doc = useRef<pdfjs.PDFDocumentProxy | null>(null);
  const pages = useRef<PageView[]>([]);
  const generation = useRef(0);
  const drawn = useRef(1);
  const raf = useRef(0);

  const [mode, setMode] = useState<Mode>(
    () => (window.localStorage.getItem("nexttex.pdf.mode") as Mode) || "scroll",
  );
  // 0 means "fit the width", -1 means "fit a whole page"; anything else is
  // a zoom the reader chose.
  const [scale, setScale] = useState(0);
  const [fitScale, setFitScale] = useState(1);
  const [pageFitScale, setPageFitScale] = useState(1);
  const [pageCount, setPageCount] = useState(0);
  const [current, setCurrent] = useState(1);
  const [missing, setMissing] = useState(false);

  const stamp = useStore((s) => s.pdfStamp);
  const projectId = useStore((s) => s.projectId);

  const modeRef = useRef(mode);
  modeRef.current = mode;
  const currentRef = useRef(current);
  currentRef.current = current;

  // ---- where the reader is, in a form that survives a rebuild -----------
  const anchor = useCallback(() => {
    const root = scroller.current;
    if (!root || !pages.current.length) return { index: 0, fraction: 0 };
    if (modeRef.current === "page") {
      return { index: currentRef.current - 1, fraction: 0 };
    }
    const top = root.scrollTop;
    for (let index = 0; index < pages.current.length; index += 1) {
      const element = pages.current[index].container;
      if (top < element.offsetTop + element.offsetHeight) {
        return {
          index,
          fraction: (top - element.offsetTop) / (element.offsetHeight || 1),
        };
      }
    }
    return { index: pages.current.length - 1, fraction: 0 };
  }, []);

  const restore = useCallback((position: { index: number; fraction: number }) => {
    const root = scroller.current;
    if (!root || !pages.current.length) return;
    const index = Math.min(Math.max(position.index, 0), pages.current.length - 1);
    if (modeRef.current === "page") {
      setCurrent(index + 1);
      root.scrollTop = 0;
      return;
    }
    const element = pages.current[index].container;
    root.scrollTop = element.offsetTop + position.fraction * element.offsetHeight;
  }, []);

  // ---- drawing ----------------------------------------------------------
  const renderPage = useCallback(async (index: number) => {
    const view = pages.current[index];
    const document = doc.current;
    if (!view || !document) return;
    if (view.drawnFor === generation.current) return;   // already current
    if (view.task) return;                              // in flight
    const mine = generation.current;
    try {
      const page = await document.getPage(index + 1);
      if (mine !== generation.current) return;
      const viewport = page.getViewport({ scale: view.scale * RESOLUTION });
      const canvas = view.canvas;
      if (canvas.width !== Math.floor(viewport.width)) {
        canvas.width = Math.floor(viewport.width);
        canvas.height = Math.floor(viewport.height);
      }
      const context = canvas.getContext("2d", { alpha: false });
      if (!context) return;
      view.task = page.render({ canvasContext: context, viewport } as any);
      await view.task.promise;
      if (mine === generation.current) view.drawnFor = mine;
    } catch {
      /* superseded, or the page went away with the document */
    } finally {
      view.task = null;
    }
  }, []);

  /** Draw what is on screen, and the page either side of it. */
  const drawVisible = useCallback(() => {
    const root = scroller.current;
    if (!root || !pages.current.length) return;
    if (modeRef.current === "page") {
      const index = currentRef.current - 1;
      renderPage(index);
      return;
    }
    const top = root.scrollTop - NEAR;
    const bottom = root.scrollTop + root.clientHeight + NEAR;
    let first = -1;
    for (let index = 0; index < pages.current.length; index += 1) {
      const element = pages.current[index].container;
      const start = element.offsetTop;
      const end = start + element.offsetHeight;
      if (end < top || start > bottom) continue;
      if (first < 0) first = index;
      renderPage(index);
    }
    if (first >= 0 && first + 1 !== currentRef.current) setCurrent(first + 1);
  }, [renderPage]);

  const onScroll = useCallback(() => {
    // One pass per frame at most: scroll events fire far faster than
    // anything useful can be drawn, and this is the hot path.
    if (raf.current) return;
    raf.current = window.requestAnimationFrame(() => {
      raf.current = 0;
      drawVisible();
    });
  }, [drawVisible]);

  // ---- laying the document out ------------------------------------------
  const layout = useCallback(
    async (document: pdfjs.PDFDocumentProxy, keep: boolean) => {
      const container = sheet.current;
      if (!container) return;
      const position = keep ? anchor() : { index: 0, fraction: 0 };
      generation.current += 1;

      const count = document.numPages;
      const first = await document.getPage(1);
      const natural = first.getViewport({ scale: 1 });
      const measured = scroller.current?.clientWidth ?? 0;
      const available = (measured > 80 ? measured : 900) - 48;
      const fit = Math.max(0.2, +(available / natural.width).toFixed(3));
      setFitScale(fit);
      // A writer checking whether a figure has pushed a heading onto the
      // next page needs to see a whole page, which fit-width rarely gives.
      const height = (scroller.current?.clientHeight ?? 900) - 40;
      const pageFit = Math.max(0.2, +Math.min(fit, height / natural.height).toFixed(3));
      setPageFitScale(pageFit);
      const effective = scale === -1 ? pageFit : scale || fit;
      drawn.current = effective;

      // Reuse what is already on screen.  A rebuild usually produces a
      // document with the same page count and the same page size, and
      // recreating forty canvases for that is the single most expensive
      // thing this pane can do -- it is also what makes the preview blink.
      const reusable = pages.current.length === count;
      const views: PageView[] = [];
      for (let index = 0; index < count; index += 1) {
        const page = index === 0 ? first : await document.getPage(index + 1);
        const viewport = page.getViewport({ scale: effective });
        const width = Math.floor(viewport.width);
        const height = Math.floor(viewport.height);
        if (reusable) {
          const view = pages.current[index];
          view.task?.cancel();
          view.task = null;
          view.width = width;
          view.height = height;
          view.scale = effective;
          view.container.style.width = `${width}px`;
          view.container.style.height = `${height}px`;
          views.push(view);
          continue;
        }
        const element = window.document.createElement("div");
        element.className = "nx-page";
        element.style.width = `${width}px`;
        element.style.height = `${height}px`;
        const canvas = window.document.createElement("canvas");
        canvas.style.width = "100%";
        canvas.style.height = "100%";
        canvas.style.display = "block";
        element.appendChild(canvas);
        views.push({
          container: element, canvas, width, height,
          scale: effective, drawnFor: -1, task: null,
        });
      }

      pages.current = views;
      setPageCount(count);

      if (!reusable) {
        for (const view of pages.current) view.task?.cancel();
        const fragment = window.document.createDocumentFragment();
        for (const view of views) fragment.appendChild(view.container);
        container.replaceChildren(fragment);
      }
      applyMode(modeRef.current);
      restore(position);
      // The canvases still hold the previous render until this resolves, so
      // the pane shows the old page rather than a blank one.
      await renderPage(Math.min(position.index, count - 1));
      drawVisible();
    },
    [anchor, drawVisible, renderPage, restore, scale],
  );

  /** In page mode only one page is in the flow; in scroll mode all are. */
  const applyMode = useCallback((next: Mode) => {
    const index = currentRef.current - 1;
    pages.current.forEach((view, position) => {
      view.container.style.display =
        next === "scroll" || position === index ? "block" : "none";
    });
  }, []);

  const layoutRef = useRef(layout);
  layoutRef.current = layout;

  // ---- fetching ---------------------------------------------------------
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
        await layoutRef.current(loaded, previous !== null);
        previous?.destroy();
      } catch {
        setMissing(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [projectId, stamp]);

  // Zoom, mode and pane width all change the layout but not the document.
  useEffect(() => {
    if (doc.current) layoutRef.current(doc.current, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scale]);

  useEffect(() => {
    window.localStorage.setItem("nexttex.pdf.mode", mode);
    applyMode(mode);
    if (mode === "page") {
      if (scroller.current) scroller.current.scrollTop = 0;
      renderPage(current - 1);
    } else {
      drawVisible();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  useEffect(() => {
    if (modeRef.current !== "page") return;
    applyMode("page");
    renderPage(current - 1);
    if (scroller.current) scroller.current.scrollTop = 0;
  }, [current, applyMode, renderPage]);

  // A pane that changes width has to re-fit, or the page stops filling it.
  useEffect(() => {
    const root = scroller.current;
    if (!root) return;
    let timer = 0;
    const observer = new ResizeObserver((entries) => {
      // A pane that has just been collapsed reports zero width; re-fitting
      // to that would leave a page 35% wide when it comes back.
      if ((entries[0]?.contentRect.width ?? 0) < 80) return;
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        if (doc.current && !scale) layoutRef.current(doc.current, true);
        else drawVisible();
      }, 120);
    });
    observer.observe(root);
    return () => {
      observer.disconnect();
      window.clearTimeout(timer);
    };
  }, [drawVisible, scale]);

  // ---- SyncTeX ----------------------------------------------------------
  const onDoubleClick = useCallback(
    async (event: React.MouseEvent) => {
      const projectId = get().projectId;
      if (!projectId) return;
      const target = (event.target as HTMLElement).closest(".nx-page");
      if (!target) return;
      const index = pages.current.findIndex((view) => view.container === target);
      if (index < 0) return;
      const box = target.getBoundingClientRect();
      // SyncTeX works in PDF points from the top-left corner, and so does
      // the canvas, so the conversion is the scale factor and nothing else.
      const x = (event.clientX - box.left) / drawn.current;
      const y = (event.clientY - box.top) / drawn.current;
      try {
        const result = await api.inverse(projectId, index + 1, x, y);
        if (result.found && result.file && result.line) {
          onNavigate(result.file, result.line);
        }
      } catch {
        /* a click that lands on nothing is not an error worth reporting */
      }
    },
    [onNavigate],
  );

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
          const zoom = drawn.current;
          if (modeRef.current === "page") {
            setCurrent(position.page);
            await renderPage(position.page - 1);
          } else {
            root.scrollTo({
              top: Math.max(
                view.container.offsetTop +
                  (position.y - position.height) * zoom -
                  root.clientHeight / 3,
                0,
              ),
            });
          }
          const flash = window.document.createElement("div");
          flash.className = "nx-flash";
          flash.style.left = `${position.x * zoom}px`;
          flash.style.top = `${(position.y - position.height) * zoom}px`;
          flash.style.width = `${Math.max(position.width * zoom, 12)}px`;
          flash.style.height = `${Math.max(position.height * zoom, 10)}px`;
          view.container.appendChild(flash);
          window.setTimeout(() => (flash.style.opacity = "0"), 250);
          window.setTimeout(() => flash.remove(), 950);
          return true;
        } catch {
          return false;
        }
      },
    });
  }, [handleRef, renderPage]);

  // ---- keyboard, in page mode ------------------------------------------
  const step = useCallback(
    (delta: number) => setCurrent((value) => Math.min(Math.max(value + delta, 1), pageCount || 1)),
    [pageCount],
  );

  return (
    <div className="flex h-full min-h-0 flex-col bg-surround">
      <div
        ref={scroller}
        className={`min-h-0 flex-1 ${mode === "page" ? "overflow-auto" : "overflow-auto"}`}
        onScroll={mode === "scroll" ? onScroll : undefined}
        onDoubleClick={onDoubleClick}
        tabIndex={0}
        onKeyDown={(event) => {
          if (mode !== "page") return;
          if (event.key === "ArrowRight" || event.key === "PageDown") step(1);
          if (event.key === "ArrowLeft" || event.key === "PageUp") step(-1);
        }}
      >
        {missing ? (
          <div className="flex h-full items-center justify-center px-8 text-center">
            <div className="max-w-[42ch]">
              <p className="t-display text-ink-3">Nothing has been typeset yet.</p>
              <p className="t-meta mt-2 text-ink-2">
                An empty document produces no pages. Write a line and it will
                appear here about a second later — or start from something
                that already works.
              </p>
              {onLoadTemplate ? (
                <button
                  className="ghost-button mt-4 px-3 py-2 t-ui"
                  onClick={onLoadTemplate}
                >
                  Load a basic document
                </button>
              ) : null}
            </div>
          </div>
        ) : null}
        <div
          ref={sheet}
          className="flex w-fit min-w-full flex-col items-center gap-4 px-6 py-4"
          style={{ justifyContent: "safe center" }}
        />
      </div>

      <div className="flex h-[26px] shrink-0 items-center gap-3 border-t border-line bg-surface-2 px-[10px]">
        <div className="flex shrink-0 overflow-hidden rounded-[3px] border border-line">
          {(["scroll", "page"] as const).map((option) => (
            <button
              key={option}
              className={`t-micro border-b-2 px-2 py-[2px] transition-colors duration-[90ms] ${
                mode === option
                  ? "border-hint bg-surface text-ink"
                  : "border-transparent text-ink-3 hover:text-hint"
              }`}
              onClick={() => setMode(option)}
              title={
                option === "scroll"
                  ? "One continuous document"
                  : "One page at a time"
              }
            >
              {option === "scroll" ? "Scroll" : "Page"}
            </button>
          ))}
        </div>
        <Rule />
        {mode === "page" ? (
          <span className="flex shrink-0 items-center gap-1">
            <button
              className="nx-hover t-micro px-1 text-ink-2 hover:text-ink disabled:text-ink-3"
              disabled={current <= 1}
              onClick={() => step(-1)}
              aria-label="Previous page"
            >
              ‹
            </button>
            <span className="t-micro tnum w-[92px] text-center text-ink-2">
              {pageCount ? `Page ${current} of ${pageCount}` : "—"}
            </span>
            <button
              className="nx-hover t-micro px-1 text-ink-2 hover:text-ink disabled:text-ink-3"
              disabled={current >= pageCount}
              onClick={() => step(1)}
              aria-label="Next page"
            >
              ›
            </button>
          </span>
        ) : (
          <span className="t-micro tnum shrink-0 text-ink-2">
            {pageCount ? `Page ${current} of ${pageCount}` : "—"}
          </span>
        )}
        <Rule />
        <button
          className="nx-hover t-micro px-1 text-ink-2 hover:text-ink"
          onClick={() =>
            setScale((value) =>
              Math.max(0.25, +((value === -1 ? pageFitScale : value || fitScale) - 0.15).toFixed(2)),
            )
          }
          aria-label="Zoom out"
        >
          −
        </button>
        <span className="t-micro tnum w-[38px] text-center text-ink-3">
          {Math.round((scale === -1 ? pageFitScale : scale || fitScale) * 100)}%
        </span>
        <button
          className="nx-hover t-micro px-1 text-ink-2 hover:text-ink"
          onClick={() =>
            setScale((value) =>
              Math.min(3, +((value === -1 ? pageFitScale : value || fitScale) + 0.15).toFixed(2)),
            )
          }
          aria-label="Zoom in"
        >
          +
        </button>
        <Rule />
        <button
          className={`quiet t-micro ${scale === 0 ? "text-ink" : ""}`}
          onClick={() => setScale(0)}
        >
          Fit width
        </button>
        <button
          className={`quiet t-micro ${scale === -1 ? "text-ink" : ""}`}
          onClick={() => setScale(-1)}
        >
          Fit page
        </button>
      </div>
    </div>
  );
}

function Rule() {
  return <span className="h-[10px] w-px shrink-0 bg-line" />;
}
