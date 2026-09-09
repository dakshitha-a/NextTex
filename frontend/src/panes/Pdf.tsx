import { useCallback, useEffect, useRef, useState } from "react";
import * as pdfjs from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import api from "../api";
import { get, useStore } from "../store";
import { uiScale } from "../viewport";
import { absenceFrom, type Absence } from "./pdf-absence";
import { APPEARANCE_CHANGED } from "../appearance";
import {
  backingFor,
  pinchDelta,
  rasterKey,
  resolutionFor,
  type PreviewQuality,
} from "./pdf-raster";

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

/** Extra device pixels so text stays crisp without quadrupling the work.
 *
 *  Read per render rather than once at module load, because three of its
 *  three inputs change while the app is open: the interface size is a `zoom`
 *  on the shell, the device ratio changes when the window moves to another
 *  screen or the browser's own zoom is used, and the writer can ask for a
 *  different quality.  A canvas drawn for the old ratio is stretched by the
 *  browser, and a soft page is the one thing this pane cannot ship.
 *
 *  The arithmetic is in `pdf-raster.ts` so it can be tested; this reads the
 *  three inputs out of the window and hands them over. */
function quality(): PreviewQuality {
  const asked = window.document.documentElement.dataset.previewQuality;
  return asked === "faster" || asked === "sharper" ? asked : "balanced";
}

function resolution(): number {
  return resolutionFor(window.devicePixelRatio || 1, uiScale(), quality());
}

/** How far outside the viewport a page is still worth drawing. */
const NEAR = 400;

/** The range the zoom controls and the wheel share, so a pinch cannot
 *  reach a scale the buttons will not admit to. */
const MIN_ZOOM = 0.25;
const MAX_ZOOM = 3;

/** How long after the last wheel event the crisp redraw runs.  Short enough
 *  to feel immediate, long enough that one pinch is one redraw.
 *
 *  A wheel has no end-of-gesture event, so this timer is the only signal
 *  that a pinch has finished.  At 140 ms an ordinary mid-pinch pause -- the
 *  moment where fingers reset -- committed the zoom, relaid the document
 *  out and redrew every visible canvas, and the gesture then resumed
 *  against a page that had just jumped under it. */
const ZOOM_SETTLE = 260;

/** How often pages may be drawn *during* a pinch.
 *
 *  Zooming out reveals pages that have never been drawn, and leaving them
 *  blank for the length of the gesture is worse than the cost of drawing
 *  them.  Answering every scroll the gesture causes is what is unaffordable
 *  -- that reads the geometry of every page back in the same frame the
 *  gesture has just written it -- so during a pinch the pass runs a few
 *  times a second instead of sixty. */
const ZOOM_DRAW_INTERVAL = 200;

export type PdfHandle = {
  reveal(path: string, line: number): Promise<boolean>;
};

type Mode = "scroll" | "page";

type PageView = {
  container: HTMLDivElement;
  canvas: HTMLCanvasElement;
  /** The selectable text over the picture.  A canvas is an image of a
   *  page: it cannot be selected, searched or copied out of, which for a
   *  document somebody is quoting from is most of what a PDF is for. */
  text: HTMLDivElement;
  /** The generation this layer was built from, so it is rebuilt exactly
   *  when the canvas beneath it is redrawn and not on every scroll. */
  textFor: number;
  textScale: number;
  width: number;
  height: number;
  scale: number;
  /** The document generation this canvas was drawn from. */
  drawnFor: number;
  /** The device-pixel ratio this canvas was actually drawn at.  Kept so a
   *  browser zoom or a move to another screen can be noticed: those change
   *  the ratio without changing the layout, so nothing else would. */
  drawnAt: number;
  task: pdfjs.RenderTask | null;
};

export default function Pdf({
  onNavigate,
  onLoadTemplate,
  handleRef,
  document: showing = "",
  source,
}: {
  onNavigate: (file: string, line: number, word?: string) => void;
  onLoadTemplate?: () => void;
  handleRef: (handle: PdfHandle) => void;
  /** Which document's PDF this pane is showing.  Empty means the main one,
   *  which is what a project with a single document has always meant. */
  document?: string;
  /** A PDF that is not build output.
   *
   *  A writer keeps figures as PDF so they scale, and until this existed
   *  the one thing this app could not show was a PDF: the tree called it an
   *  image, the image viewer refused it, and it fell through to a Download
   *  button in an application that has PDF.js loaded a column away.  Given
   *  a URL, this pane draws that instead of the build, with the same zoom,
   *  the same page controls and the same rasteriser.
   *
   *  Double-clicking still asks synctex where a word came from when this is
   *  absent, and does nothing when it is set: there is no source file
   *  behind somebody's figure, and an inverse search against the main
   *  document would land on a line that has nothing to do with it. */
  source?: string;
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
  // What the footer shows.  Written to the node rather than held in state:
  // the committed `scale` only catches up when the pinch stops, and a
  // percentage frozen at the old number for the whole gesture reads as
  // though the zoom is not working -- but a `setState` per wheel event
  // re-renders the whole footer at gesture rate, which is exactly the cost
  // a pinch cannot afford.  One writer, so the two cannot disagree.
  const zoomText = useRef<HTMLSpanElement | null>(null);
  const showZoom = useCallback((value: number) => {
    if (zoomText.current) zoomText.current.textContent = `${Math.round(value * 100)}%`;
  }, []);
  const [pageCount, setPageCount] = useState(0);
  const [current, setCurrent] = useState(1);
  const [absence, setAbsence] = useState<Absence>("");

  // This document's own build stamp, not the project's: a build of another
  // preview must not make this pane re-fetch a PDF that has not changed.
  const stamp = useStore((s) => s.builds[showing]?.pdfStamp ?? s.pdfStamp);
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
  /** The selectable text over one page.
   *
   *  Built only for pages on screen, and only once per page per build: a
   *  page of a dense thesis is several hundred positioned spans, and doing
   *  that for a forty-page document -- or on every frame of a pinch --
   *  would cost more than the picture it sits on.
   */
  const renderText = useCallback(async (index: number) => {
    const view = pages.current[index];
    const document = doc.current;
    if (!view || !document) return;
    if (view.textFor === generation.current && view.textScale === view.scale) return;
    const mine = generation.current;
    view.textFor = mine;
    view.textScale = view.scale;
    try {
      const page = await document.getPage(index + 1);
      if (mine !== generation.current) return;
      const viewport = page.getViewport({ scale: view.scale });
      view.text.replaceChildren();
      // Built at the committed scale, so any gesture transform is spent.
      view.text.style.transform = "";
      // pdf.js positions its spans in unscaled units and divides by this.
      view.text.style.setProperty("--scale-factor", String(view.scale));
      const layer = new pdfjs.TextLayer({
        textContentSource: page.streamTextContent(),
        container: view.text,
        viewport,
      });
      await layer.render();
      if (mine !== generation.current) view.text.replaceChildren();
    } catch {
      // A page whose text cannot be read is still a page you can look at.
      view.textFor = -1;
    }
  }, []);

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
      // The box the canvas is actually painted into, which is not the one
      // the page container was given.  `.nx-page` carries a one pixel
      // border, and the canvas fills the content box inside it, so a
      // container asked for 441 shows a canvas 439 wide.  The backing store
      // was sized from the container all the same, so every page was drawn
      // two device pixels wider than the box it was displayed in and then
      // squashed to fit.  That is a resample of every pixel of every page at
      // every zoom, and it is what a soft page looks like.
      //
      // Measured from the element rather than by subtracting a border, so a
      // later change to the page's frame cannot quietly bring this back.
      const canvas = view.canvas;
      // The container's content box, which is what the canvas fills: the
      // border is outside it.  Read from the container rather than the canvas
      // because the canvas keeps `width: 100%`, and it has to: the pinch
      // gesture rescales the container and lets what is already drawn follow
      // it, instantly, at the right scroll extents.  Pinning the canvas to a
      // pixel size here froze it mid-gesture.
      const boxWidth = view.container.clientWidth || view.width;
      const boxHeight = view.container.clientHeight || view.height;
      // One function returns the store and the ratio together, from one
      // floored box, so the two cannot be rounded separately again.  It also
      // carries the area guard, which reduces the ratio rather than the box
      // when a page would be too big for the browser to allocate at all.
      const backing = backingFor(boxWidth, boxHeight, resolution());
      const natural = page.getViewport({ scale: 1 });
      const viewport = page.getViewport({ scale: backing.width / natural.width });
      const width = Math.floor(viewport.width);
      const height = Math.floor(viewport.height);
      // Both dimensions, and together: the height used to be assigned only
      // when the width happened to change, so a page that grew taller at the
      // same width kept a stale backing store.
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }
      const context = canvas.getContext("2d", { alpha: false });
      if (!context) return;
      view.drawnAt = rasterKey(width / boxWidth);
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
      renderText(index);
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
      renderText(index);
    }
    if (first >= 0 && first + 1 !== currentRef.current) setCurrent(first + 1);
  }, [renderPage, renderText]);

  // Everything that changes how many device pixels a page needs, and
  // nothing that changes its size on screen.
  //
  // Deliberately not a bump of `generation`, which is the supersession token
  // for `layout`: raising it from out here makes any layout currently
  // between awaits give up at its next check and leave the pane unlaid.
  // Cancel the drawing instead.  That also closes the hole this had: a page
  // whose render was in flight when the interface changed was skipped by the
  // in-flight guard and then marked current, keeping the bitmap it had drawn
  // at the old resolution.
  const invalidateRaster = useCallback(() => {
    for (const view of pages.current) {
      view.task?.cancel();
      view.task = null;
      view.drawnFor = -1;
      view.drawnAt = 0;
    }
    drawVisible();
  }, [drawVisible]);

  useEffect(() => {
    window.addEventListener(APPEARANCE_CHANGED, invalidateRaster);
    return () => window.removeEventListener(APPEARANCE_CHANGED, invalidateRaster);
  }, [invalidateRaster]);

  // (b) The window moved to a screen of another density, or the browser's
  // own zoom changed, both of which change `devicePixelRatio` and neither of
  // which fires anything this pane was listening for.  A resolution query is
  // pinned to the value it was made with, so it is re-armed after each
  // change rather than kept.
  useEffect(() => {
    let query: MediaQueryList | null = null;
    let cancelled = false;
    const arm = () => {
      if (cancelled) return;
      query?.removeEventListener("change", onChange);
      query = window.matchMedia(
        `(resolution: ${window.devicePixelRatio || 1}dppx)`,
      );
      query.addEventListener("change", onChange);
    };
    const onChange = () => {
      arm();
      invalidateRaster();
    };
    arm();
    return () => {
      cancelled = true;
      query?.removeEventListener("change", onChange);
    };
  }, [invalidateRaster]);

  const onScroll = useCallback(() => {
    // A pinch sets `scrollTop` itself, and the scroll that follows is not a
    // reader moving through the document.  Answering every one of them
    // reads the geometry of every page back in the same frame the gesture
    // has just written it, which is a second layout per frame -- but
    // refusing outright leaves a page revealed by zooming out blank until
    // the gesture ends.  So it is rationed rather than refused.
    if (zooming.current) {
      const now = performance.now();
      if (now - lastZoomDraw.current < ZOOM_DRAW_INTERVAL) return;
      lastZoomDraw.current = now;
    }
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
      const mine = (generation.current += 1);
      // Every await below is a place a newer layout can start and finish
      // first -- a rebuild landing while the split handle is being dragged
      // does exactly that.  Without this the older run wrote its stale
      // array over the newer one's, leaving page elements that are not in
      // the document any more: offsetTop reads 0 for all of them, so
      // drawVisible thinks every page is on screen and renders all of them.
      const superseded = () => generation.current !== mine;

      const count = document.numPages;
      const first = await document.getPage(1);
      if (superseded()) return;
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
      // In parallel: awaiting two hundred pages one after another costs two
      // hundred round trips through the microtask queue before a single
      // pixel can be drawn, and this runs on every rebuild.
      const sheets = await Promise.all(
        Array.from({ length: count }, (_, index) =>
          index === 0 ? first : document.getPage(index + 1),
        ),
      );
      if (superseded()) return;
      const views: PageView[] = [];
      for (let index = 0; index < count; index += 1) {
        const page = sheets[index];
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
        const text = window.document.createElement("div");
        text.className = "nx-text-layer";
        element.appendChild(text);
        views.push({
          container: element, canvas, text, width, height,
          scale: effective, drawnFor: -1, drawnAt: 0, textFor: -1, textScale: 0, task: null,
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
      if (superseded()) return;
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
        const response = await fetch(source || api.pdfUrl(projectId, showing, stamp), {
          credentials: "same-origin",
        });
        if (!response.ok) {
          setAbsence(absenceFrom(response));
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
        setAbsence("");
        await layoutRef.current(loaded, previous !== null);
        previous?.destroy();
      } catch {
        // Never got an answer at all, which is not the same as being told
        // there is nothing to show.
        setAbsence(absenceFrom(null));
      }
    })();
    return () => {
      cancelled = true;
    };
    // `showing` too: switching preview tabs is a different document,
    // not a rebuild of this one.  `source` for the same reason: opening a
    // second figure is a different document, not a redraw of the first.
  }, [projectId, showing, stamp, source]);

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
        if (doc.current && !scale) {
          layoutRef.current(doc.current, true);
          return;
        }
        // At a reader-chosen zoom the layout does not change, so this used
        // to call `drawVisible`, which skips every page already marked
        // current and therefore redrew nothing.  A browser Ctrl-plus changes
        // the pane width and the device ratio together, so the page was left
        // stretched over a bigger box until something else invalidated it.
        // Compare what the raster was drawn for, and redraw only if it moved.
        const wanted = rasterKey(resolution());
        const stale = pages.current.some(
          (view) => view.drawnFor >= 0 && view.drawnAt !== wanted,
        );
        if (stale) invalidateRaster();
        else drawVisible();
      }, 120);
    });
    observer.observe(root);
    return () => {
      observer.disconnect();
      window.clearTimeout(timer);
    };
  }, [drawVisible, invalidateRaster, scale]);

  // ---- zooming with the wheel or a trackpad -----------------------------
  // A reader zooms a page the way they zoom everything else: ctrl with the
  // wheel, or a pinch on a trackpad -- which every browser delivers as a
  // wheel event with `ctrlKey` set.  Two things make this worth more than
  // ten lines.
  //
  // The listener has to be a native one.  React registers `wheel` passively
  // on its root, so `preventDefault` inside `onWheel` is ignored and the
  // browser zooms the whole application instead of the document.
  //
  // And the gesture must not relayout the document sixty times a second.
  // Each page is a canvas sized by its container, so resizing the
  // containers rescales what is already drawn -- instantly, at the right
  // scroll extents, slightly soft.  The crisp redraw happens once, when the
  // gesture stops.
  const liveScale = useRef(0);
  const commit = useRef(0);
  // Set while a pinch is in flight, so the scroll handler knows to stay out
  // of the way: the gesture writes `scrollTop` itself, and letting that
  // fire a redraw pass would read `offsetTop` off every page in the
  // document and lay it all out a second time in the same frame.
  const zooming = useRef(false);
  const lastZoomDraw = useRef(0);
  useEffect(() => {
    const root = scroller.current;
    if (!root) return;

    // A gesture arrives as a stream of wheel events at whatever rate the
    // trackpad reports -- faster than frames, and each one used to resize
    // every page and then read the scroller back, which forces the browser
    // to lay the document out again mid-event.  The events are accumulated
    // instead and applied once per frame, and within that frame every read
    // happens before every write, so the layout the browser already has is
    // still valid when it is read.
    let pending: { deltaY: number; x: number; y: number } | null = null;
    let frame = 0;
    let box: DOMRect | null = null;

    const apply = () => {
      frame = 0;
      const gesture = pending;
      pending = null;
      if (!gesture || !box) return;

      // --- reads, all of them, before anything is written ---
      const scrollLeft = root.scrollLeft;
      const scrollTop = root.scrollTop;

      const from = liveScale.current || drawn.current || 1;
      const next = Math.min(
        MAX_ZOOM,
        Math.max(MIN_ZOOM, +(from * Math.exp(-gesture.deltaY * 0.002)).toFixed(3)),
      );
      if (next === from) return;
      liveScale.current = next;

      // --- writes ---
      // Keep what is under the pointer under the pointer.  Sizes come from
      // each page's committed scale rather than the last frame's, so a long
      // gesture cannot drift by accumulating rounding.
      for (const view of pages.current) {
        if (!view.scale) continue;
        view.container.style.width = `${Math.floor((view.width / view.scale) * next)}px`;
        view.container.style.height = `${Math.floor((view.height / view.scale) * next)}px`;
        // The text is positioned in pixels computed at the scale it was
        // built for, so without this it stays where it was while the page
        // grows under it and a selection made mid-gesture lands a word
        // out.  A transform rather than a rebuild: the compositor does it,
        // and rebuilding several hundred spans per frame is the cost this
        // whole handler exists to avoid.
        view.text.style.transform = `scale(${next / view.scale})`;
      }
      // The pointer position is the frame's last one, not its first: a
      // pinch that travels across the page has to anchor to where the
      // fingers are now.
      const offsetX = gesture.x - box.left;
      const offsetY = gesture.y - box.top;
      const ratio = next / from;
      root.scrollLeft = (scrollLeft + offsetX) * ratio - offsetX;
      root.scrollTop = (scrollTop + offsetY) * ratio - offsetY;
      showZoom(next);

      window.clearTimeout(commit.current);
      commit.current = window.setTimeout(() => {
        zooming.current = false;
        box = null;
        setScale(next);
      }, ZOOM_SETTLE);
    };

    const onWheel = (event: WheelEvent) => {
      if (!event.ctrlKey && !event.metaKey) return;
      event.preventDefault();
      // A trackpad reports pixels; a wheel may report lines or pages.
      const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? 100 : 1;
      pending = {
        deltaY: (pending?.deltaY ?? 0) + event.deltaY * unit,
        x: event.clientX,
        y: event.clientY,
      };
      // The scroller does not move during a pinch, so its box is read once
      // rather than after every batch of size changes -- reading it there
      // was the forced reflow.
      if (!box) box = root.getBoundingClientRect();
      zooming.current = true;
      if (!frame) frame = window.requestAnimationFrame(apply);
    };

    // The same gesture from two fingers.  Everything downstream is the wheel
    // path unchanged: the limits, the frame coalescing, the redraw rationing
    // while the gesture runs, and the commit when it stops.
    //
    // One real difference, and it is worth saying rather than hiding: a touch
    // gesture has an end event.  `ZOOM_SETTLE` exists only because a wheel
    // does not, so a pinch commits when the fingers lift instead of waiting
    // out a timer that is guessing.
    let spread = 0;
    const between = (touches: TouchList) => {
      const [a, b] = [touches[0], touches[1]];
      return Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
    };

    const onTouchStart = (event: TouchEvent) => {
      if (event.touches.length !== 2) return;
      event.preventDefault();
      spread = between(event.touches);
      if (!box) box = root.getBoundingClientRect();
      zooming.current = true;
    };

    const onTouchMove = (event: TouchEvent) => {
      if (event.touches.length !== 2 || !spread) return;
      event.preventDefault();
      const now = between(event.touches);
      const [a, b] = [event.touches[0], event.touches[1]];
      pending = {
        deltaY: (pending?.deltaY ?? 0) + pinchDelta(spread, now),
        x: (a.clientX + b.clientX) / 2,
        y: (a.clientY + b.clientY) / 2,
      };
      spread = now;
      if (!box) box = root.getBoundingClientRect();
      if (!frame) frame = window.requestAnimationFrame(apply);
    };

    const onTouchEnd = () => {
      if (!spread) return;
      spread = 0;
      // The fingers have lifted, so there is nothing left to wait for.
      window.clearTimeout(commit.current);
      commit.current = window.setTimeout(() => {
        zooming.current = false;
        setScale(liveScale.current);
      }, 0);
    };

    root.addEventListener("wheel", onWheel, { passive: false });
    root.addEventListener("touchstart", onTouchStart, { passive: false });
    root.addEventListener("touchmove", onTouchMove, { passive: false });
    root.addEventListener("touchend", onTouchEnd);
    root.addEventListener("touchcancel", onTouchEnd);
    return () => {
      root.removeEventListener("wheel", onWheel);
      root.removeEventListener("touchstart", onTouchStart);
      root.removeEventListener("touchmove", onTouchMove);
      root.removeEventListener("touchend", onTouchEnd);
      root.removeEventListener("touchcancel", onTouchEnd);
      window.clearTimeout(commit.current);
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, [showZoom]);

  // The gesture's own idea of the scale outlives the commit on purpose: a
  // pinch that lands between committing and the relayout finishing would
  // otherwise read `drawn.current`, which is still the previous scale, and
  // jump backwards.  It is cleared only when the zoom is changed by
  // something that is not the wheel -- a button, fit width, a new document.
  useEffect(() => {
    const settled = scale === -1 ? pageFitScale : scale || fitScale;
    if (liveScale.current && Math.abs(liveScale.current - settled) > 0.002) {
      liveScale.current = 0;
    }
  }, [scale, fitScale, pageFitScale]);

  // The settled percentage.  Written here rather than rendered, so that the
  // gesture and the resting state have one writer between them: React
  // reconciling a text node it believes is already correct would leave
  // whatever the last frame of a pinch put there.
  useEffect(() => {
    if (zooming.current) return;
    showZoom(scale === -1 ? pageFitScale : scale || fitScale);
  }, [scale, fitScale, pageFitScale, showZoom]);

  // ---- SyncTeX ----------------------------------------------------------
  const onDoubleClick = useCallback(
    async (event: React.MouseEvent) => {
      const projectId = get().projectId;
      if (!projectId) return;
      // A figure has no source file behind it, so there is nothing to jump
      // to.  Asking anyway would run an inverse search against the main
      // document and land the caret on an unrelated line.
      if (source) return;
      const target = (event.target as HTMLElement).closest(".nx-page");
      if (!target) return;
      const index = pages.current.findIndex((view) => view.container === target);
      if (index < 0) return;
      // Read before the await, and before anything else can clear it: the
      // second click of a double-click selects a word, and by the time
      // synctex has answered the selection is gone. It is what makes the
      // jump land on the word rather than at the start of its line --
      // synctex reports `Column:-1` and never anything else.
      const word = String(window.getSelection() ?? "");
      const box = target.getBoundingClientRect();
      // SyncTeX works in PDF points from the top-left corner, and so does
      // the canvas, so the conversion is the scale factor and nothing else.
      const x = (event.clientX - box.left) / drawn.current;
      const y = (event.clientY - box.top) / drawn.current;
      try {
        const result = await api.inverse(projectId, index + 1, x, y, showing);
        if (result.found && result.file && result.line) {
          onNavigate(result.file, result.line, word);
        }
      } catch {
        /* a click that lands on nothing is not an error worth reporting */
      }
    },
    // `showing` is read inside and was missing, so after switching preview
    // tabs a double-click asked synctex about the document that had been
    // open before, and landed the caret in the wrong file.
    [onNavigate, showing, source],
  );

  useEffect(() => {
    handleRef({
      reveal: async (path: string, line: number) => {
        const projectId = get().projectId;
        if (!projectId) return false;
        try {
          const result = await api.forward(projectId, path, line, showing);
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
    // `showing` for the same reason as the handler above: forward search
    // would look up a line in whichever document was open when this was
    // last built.
  }, [handleRef, renderPage, showing]);

  // ---- keyboard, in page mode ------------------------------------------
  const step = useCallback(
    (delta: number) => setCurrent((value) => Math.min(Math.max(value + delta, 1), pageCount || 1)),
    [pageCount],
  );

  return (
    <div className="flex h-full min-h-0 flex-col bg-surround">
      <div
        ref={scroller}
        className="min-h-0 flex-1 overflow-auto"
        onScroll={mode === "scroll" ? onScroll : undefined}
        onDoubleClick={onDoubleClick}
        tabIndex={0}
        onKeyDown={(event) => {
          if (mode !== "page") return;
          if (event.key === "ArrowRight" || event.key === "PageDown") step(1);
          if (event.key === "ArrowLeft" || event.key === "PageUp") step(-1);
        }}
      >
        {absence === "empty" ? (
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
        {absence === "unreachable" ? (
          <div className="flex h-full items-center justify-center px-8 text-center">
            <div className="max-w-[42ch]">
              <p className="t-display text-ink-3">The preview could not be fetched.</p>
              <p className="t-meta mt-2 text-ink-2">
                Your document is not the problem, and nothing has been lost.
                This tries again after the next build.
              </p>
            </div>
          </div>
        ) : null}
        <div
          ref={sheet}
          className="flex w-fit min-w-full flex-col items-center gap-4 px-6 py-4"
          style={{ justifyContent: "safe center" }}
        />
      </div>

      {/* Furniture, like the status strip it sits beside.  The two are the
          same 26px band along the bottom of the window, and with only one of
          them dark the app ended in a plinth that changed colour halfway
          across.  They are one edge, so they are one ground. */}
      <div className="nx-furniture @container flex h-[26px] shrink-0 items-center gap-3 overflow-hidden whitespace-nowrap border-t border-line bg-surface-2 px-[10px]">
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
              className="nx-tap [--nx-tap-y:26px] nx-hover t-micro px-1 text-ink-2 hover:text-ink disabled:text-ink-3"
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
              className="nx-tap [--nx-tap-y:26px] nx-hover t-micro px-1 text-ink-2 hover:text-ink disabled:text-ink-3"
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
          className="nx-tap [--nx-tap-y:26px] nx-hover t-micro px-1 text-ink-2 hover:text-ink"
          onClick={() =>
            setScale((value) =>
              Math.max(MIN_ZOOM, +((value === -1 ? pageFitScale : value || fitScale) - 0.15).toFixed(2)),
            )
          }
          aria-label="Zoom out"
        >
          −
        </button>
        <span
          ref={zoomText}
          className="t-micro tnum w-[38px] text-center text-ink-3"
          data-testid="zoom"
        />
        <button
          className="nx-tap [--nx-tap-y:26px] nx-hover t-micro px-1 text-ink-2 hover:text-ink"
          onClick={() =>
            setScale((value) =>
              Math.min(MAX_ZOOM, +((value === -1 ? pageFitScale : value || fitScale) + 0.15).toFixed(2)),
            )
          }
          aria-label="Zoom in"
        >
          +
        </button>
        <Rule />
        {/* Dropped when the pane is too narrow for them, rather than
            wrapped: this is a 26px strip, and a second line of it is
            clipped by definition.  Dragging the chat handle wide was
            enough to break "Fit width" across two lines. */}
        <button
          className="quiet t-micro hidden shrink-0 whitespace-nowrap @[330px]:block"
          data-tone={scale === 0 ? "on" : undefined}
          onClick={() => setScale(0)}
        >
          Fit width
        </button>
        <button
          className="quiet t-micro hidden shrink-0 whitespace-nowrap @[400px]:block"
          data-tone={scale === -1 ? "on" : undefined}
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
