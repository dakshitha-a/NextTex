import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { duration, panesMoving, whenPanesRest } from "../motion";
import * as pdfjs from "pdfjs-dist";
import { textAtPoint } from "./pdf-click";
import { addEndOfContent, guardSelection } from "./pdf-select";
import { pdfWorker } from "./pdf-worker";
import api from "../api";
import { download, stemOf } from "../chrome";
import { get, useStore } from "../store";
import { Button, IconButton } from "../ui/Button";
import { Field, Input, Pressable, Segmented } from "../ui/controls";
import { CheckIcon, ChevronDownIcon, ChevronLeftIcon, ChevronRightIcon, ChevronUpIcon, CloseIcon, SearchIcon } from "../ui/icons";
import { Menu, MenuDivider, MenuItem } from "../ui/Menu";
import { atPointer, claimsRightClick, under, type Wanted } from "../place-menu";
import {
  boxOnTurned, darkTransfer, figureBoxes, fromTurned, nextRotation, onCanvas, parseColour,
  type Rotation,
} from "./pdf-view";
import { toShell, uiScale } from "../viewport";
import { absenceFrom, type Absence } from "./pdf-absence";
import type { WordHint } from "./locate-word";
import { findIn, spanFor, textOf, type PageHit } from "./pdf-find";
import { APPEARANCE_CHANGED, readStored, writeStored } from "../appearance";
import {
  backingFor,
  pinchDelta,
  rasterKey,
  resolutionFor,
  type PreviewQuality,
} from "./pdf-raster";


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
/** How far past the drawing window a drawn page keeps its pixels, in
 *  screen heights. Beyond it the canvas gives its backing store back and is
 *  drawn again on the way back: reading a 600-page thesis through once left
 *  147 megapixels of canvas, about 590 MB, climbing with every page read
 *  (Q-031). Three screens either side keeps a page scrolled back to at
 *  once from blanking. */
const KEEP_SCREENS = 3;

/** The range the zoom controls and the wheel share, so a pinch cannot
 *  reach a scale the buttons will not admit to. */
/** Where on a page something asked about, in viewport pixels: a
 *  double-click, or the right-click the page menu was opened with. */
type PagePoint = { target: EventTarget; clientX: number; clientY: number };

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
  /** Turn to a page, once the document has that many.  The agent's
   *  `show_page` arrives with the strip's switch to the document in the
   *  same event, so the page it names may not be drawn yet; the request
   *  is kept until the page count says it exists. */
  goTo: (page: number) => void;
  /** Show where a source line ended up on the page.
   *
   *  `gentle` is what an agent's edit asks for rather than what a person
   *  asks for. A double-click or Cmd-Enter is somebody saying take me
   *  there, so it goes there whatever is on screen. The agent announcing
   *  that it wrote something is not, so a gentle reveal moves the view only
   *  when the target is not already in front of the reader: section 6's
   *  anti-jump rule exists because a preview that shifts under somebody
   *  reading it is worse than one that has not caught up. */
  reveal(path: string, line: number, gentle?: boolean): Promise<boolean>;
};

type Mode = "scroll" | "page";

/** Paint the violet rectangle over a box on the page, and take it away.
 *
 *  Lifted out of the reveal handle because there are two exits from that
 *  function now: one that scrolls first and one that has decided the reader
 *  is already looking at the right place. Both owe them the highlight, and
 *  the two used to be one because there was only one exit.
 */
function flash(
  view: PageView,
  position: { x: number; y: number; width: number; height: number },
  zoom: number,
): void {
  // Where the box is on the page as turned: SyncTeX speaks of the page as
  // TeX set it, upright.
  const box = boxOnTurned(view.rotation, view.naturalWidth, view.naturalHeight, position);
  const mark = window.document.createElement("div");
  mark.className = "nx-flash";
  mark.style.left = `${box.left * zoom}px`;
  mark.style.top = `${box.top * zoom}px`;
  mark.style.width = `${Math.max(box.width * zoom, 12)}px`;
  mark.style.height = `${Math.max(box.height * zoom, 10)}px`;
  view.container.appendChild(mark);
  window.setTimeout(() => (mark.style.opacity = "0"), 250);
  window.setTimeout(() => mark.remove(), 950);
}

type PageView = {
  container: HTMLDivElement;
  /** The picture on screen: the canvas and, over a dark page, the figures'
   *  canvas, together in one layer.  A redraw paints a new layer out of
   *  sight and fades it in over this one, so the canvas the reader sees is
   *  never cleared, resized or half painted (the black frame after every
   *  build), and a dark page is never shown before it is darkened (the
   *  white one). */
  layer: HTMLDivElement;
  canvas: HTMLCanvasElement;
  /** Whether the layer on screen holds a picture.  A page with nothing on
   *  it yet shows its ground, and a new picture simply appears there
   *  rather than fading in over nothing. */
  painted: boolean;
  /** The selectable text over the picture.  A canvas is an image of a
   *  page: it cannot be selected, searched or copied out of, which for a
   *  document somebody is quoting from is most of what a PDF is for. */
  text: HTMLDivElement;
  /** The generation this layer was built from, so it is rebuilt exactly
   *  when the canvas beneath it is redrawn and not on every scroll. */
  textFor: number;
  textScale: number;
  /** The text layer itself, kept so a new scale or turn of the same text
   *  rescales its spans in place rather than asking the worker for the
   *  page's text and building every span again. */
  textLayer: pdfjs.TextLayer | null;
  /** The document that layer's text came from. Every layout, a zoom's
   *  too, moves the generation, so the generation cannot say whether the
   *  text is still the same; the document can. */
  textDoc: pdfjs.PDFDocumentProxy | null;
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
  /** The figures, painted back in their own colours over a dark page. */
  figures: HTMLCanvasElement | null;
  /** The page's own size in points, upright, which is what SyncTeX's
   *  coordinates are measured on, and the turn it is shown at. */
  naturalWidth: number;
  naturalHeight: number;
  rotation: Rotation;
  /** The page's box at a scale of one, as turned, unrounded. */
  baseWidth: number;
  baseHeight: number;
};

/** A page's box at a scale, in whole pixels.
 *
 *  The one rounding the layout, a pinch and a pane's live resize all use.
 *  The pinch used to scale the box it had been given and the layout to
 *  floor the page's own size, so the two disagreed by a pixel a page and
 *  the end of a pinch moved everything below the first page. */
function boxAt(view: Pick<PageView, "baseWidth" | "baseHeight">, scale: number) {
  return { width: Math.floor(view.baseWidth * scale), height: Math.floor(view.baseHeight * scale) };
}

/** How long a new picture takes to fade in over the old one: the swap
 *  token in styles.css, so the stylesheet is the one place it is set. */
const swapDuration = () => duration("swap");

/** Put a finished layer on screen.  Over a page that already shows a
 *  picture it fades in for the swap's duration, and the old picture is
 *  taken away once it is covered; over a page with nothing on it yet, it
 *  is simply there.  Any older layer still fading out goes at once, so a
 *  page never holds more than the two pictures of one swap. */
function show(
  view: PageView,
  layer: HTMLDivElement,
  canvas: HTMLCanvasElement,
  figures: HTMLCanvasElement | null,
) {
  const old = view.layer;
  const fade = view.painted && old.isConnected;
  view.layer = layer;
  view.canvas = canvas;
  view.figures = figures;
  view.painted = true;
  for (const other of Array.from(view.container.querySelectorAll(".nx-page-layer"))) {
    if (other !== layer && other !== old) other.remove();
  }
  if (!fade) {
    delete layer.dataset.incoming;
    old.remove();
    return;
  }
  // Read a size so the layer's hidden state is laid out before it changes,
  // or the browser merges the two and there is no fade to see.
  void layer.offsetWidth;
  delete layer.dataset.incoming;
  const done = () => {
    if (old !== view.layer) old.remove();
  };
  layer.addEventListener("transitionend", done, { once: true });
  window.setTimeout(done, swapDuration() + 60);
}

/** pdf.js's numbers for the operators the figure walk reads. */
const FIGURE_OPS = {
  save: pdfjs.OPS.save,
  restore: pdfjs.OPS.restore,
  transform: pdfjs.OPS.transform,
  paintImageXObject: pdfjs.OPS.paintImageXObject,
  paintInlineImageXObject: pdfjs.OPS.paintInlineImageXObject,
  paintImageXObjectRepeat: pdfjs.OPS.paintImageXObjectRepeat,
  paintFormXObjectBegin: pdfjs.OPS.paintFormXObjectBegin,
  paintFormXObjectEnd: pdfjs.OPS.paintFormXObjectEnd,
  beginGroup: pdfjs.OPS.beginGroup,
  endGroup: pdfjs.OPS.endGroup,
};

/** The dark theme's surface and body ink, whatever theme the shell is in:
 *  a dark page is dark in a light shell too. Read once from a probe. */
function darkColours(): { surface: [number, number, number]; ink: [number, number, number] } {
  const fallback = { surface: [35, 40, 37] as [number, number, number], ink: [227, 232, 226] as [number, number, number] };
  if (typeof window === "undefined") return fallback;
  const probe = window.document.createElement("div");
  probe.className = "nx-theme-dark";
  probe.style.display = "none";
  window.document.body.appendChild(probe);
  const style = window.getComputedStyle(probe);
  const surface = parseColour(style.getPropertyValue("--surface")) ?? fallback.surface;
  const ink = parseColour(style.getPropertyValue("--ink")) ?? fallback.ink;
  probe.remove();
  return { surface, ink };
}

/** The filter the dark page is baked through: white paper to the dark
 *  surface, black ink to the dark ink, and the hue turned back so a blue
 *  link stays blue. */
function DarkPageFilter() {
  const [lines] = useState(() => {
    const { surface, ink } = darkColours();
    return darkTransfer(surface, ink);
  });
  return (
    <svg width="0" height="0" aria-hidden style={{ position: "absolute" }}>
      {/* The hue is turned first and the lightness inverted after, so a
          blue link comes out blue and the paper comes out exactly the
          surface: turned last, the turn tinted the grey paper too. */}
      <filter id="nx-dark-page" colorInterpolationFilters="sRGB">
        <feColorMatrix type="hueRotate" values="180" />
        <feComponentTransfer>
          <feFuncR type="linear" slope={lines[0].slope} intercept={lines[0].intercept} />
          <feFuncG type="linear" slope={lines[1].slope} intercept={lines[1].intercept} />
          <feFuncB type="linear" slope={lines[2].slope} intercept={lines[2].intercept} />
        </feComponentTransfer>
      </filter>
    </svg>
  );
}

export default function Pdf({
  onNavigate,
  onLoadTemplate,
  onOpenBuild,
  handleRef,
  document: showing = "",
  source,
}: {
  onNavigate: (file: string, line: number, hint?: WordHint) => void;
  onLoadTemplate?: () => void;
  /** Opens the Build drawer, from the line over a kept page. */
  onOpenBuild?: () => void;
  handleRef: (handle: PdfHandle) => void;
  /** Which document's PDF this pane is showing.  Empty means whichever the
   *  server has in front, which is what a project with a single document
   *  has always meant. */
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

  // Read through the one guard, and in these initialisers above all: a
  // storage that throws, which a private window or a blocked site does,
  // threw out of `useState` here and took the whole page pane with it.
  const [mode, setMode] = useState<Mode>(
    () => (readStored("nexttex.pdf.mode") as Mode) || "scroll",
  );
  // 0 means "fit the width", -1 means "fit a whole page"; anything else is
  // a zoom the reader chose.
  const [scale, setScale] = useState(() => {
    // Beside the mode, which has been remembered all along. A reader who
    // works at 140 percent because of their eyes or their screen was
    // setting it again every session.
    const saved = Number(readStored("nexttex.pdf.zoom"));
    return Number.isFinite(saved) && saved !== 0 ? saved : 0;
  });
  const [fitScale, setFitScale] = useState(1);
  const [pageFitScale, setPageFitScale] = useState(1);
  // How the page is shown, remembered per browser like the mode and zoom:
  // a dark page, two pages side by side, and a turn a quarter at a time.
  const [dark, setDark] = useState(() => readStored("nexttex.pdf.dark") === "1");
  const [spread, setSpread] = useState(() => readStored("nexttex.pdf.spread") === "1");
  const [rotation, setRotation] = useState<Rotation>(() => {
    const saved = Number(readStored("nexttex.pdf.rotation"));
    return ([0, 90, 180, 270].includes(saved) ? saved : 0) as Rotation;
  });
  const darkRef = useRef(dark);
  darkRef.current = dark;
  // The ground under a dark page not drawn yet: the surface the dark
  // filter paints the paper as, so a page arriving on a dark sheet is the
  // colour it is about to be and never flashes the paper's white.
  const [darkGround] = useState(() => `rgb(${darkColours().surface.join(", ")})`);
  const spreadRef = useRef(spread);
  spreadRef.current = spread;
  const rotationRef = useRef(rotation);
  rotationRef.current = rotation;
  const [viewMenu, setViewMenu] = useState<{ left: number; top: number; flip: number } | null>(null);
  const viewButton = useRef<HTMLButtonElement | null>(null);
  /** The page's right-click menu: where it is open, and the point on a
   *  page it was opened at, for Show this in the source.  No point when
   *  the keyboard opened it, or when it was not over a page. */
  const [pageMenu, setPageMenu] = useState<{ at: Wanted; point: PagePoint | null } | null>(null);
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
  /** Whether the strip has any document on it.  Read through a ref by
   *  the fetch, which runs on its own dependencies. */
  const anyDocument = useStore((s) => s.previews.length > 0);
  const anyDocumentRef = useRef(anyDocument);
  anyDocumentRef.current = anyDocument;

  // ---- find on the page ---------------------------------------------------
  // The text layer has always carried every word on the page; this reads
  // it. The bar is unmounted when closed, so the footer, a 26px strip
  // already dropping controls at narrow widths, is not asked to hold an
  // input.
  const [finding, setFinding] = useState(false);
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<PageHit[]>([]);
  const [at, setAt] = useState(0);
  const findBox = useRef<HTMLInputElement | null>(null);
  /** Every page's text, extracted once per build and kept: a walk of a
   *  three-hundred-page thesis is a few hundred milliseconds once, and
   *  would be that per keystroke without this. */
  const pageTexts = useRef<{ generation: number; texts: string[] } | null>(null);
  /** The hit the reader is on, for the text layer to mark when it renders.
   *  A ref rather than state, because `renderText` is a stable callback
   *  and reads it after an await. */
  const wanted = useRef<{ page: number; occurrence: number; query: string } | null>(null);

  /** Mark the current hit on one page's text layer, if it is there.
   *
   *  Called from `renderText` once the spans exist, and directly when the
   *  layer was already current, so there is no timer waiting for the layer
   *  to appear. Clears every earlier mark first: one current hit, not a
   *  trail of them. */
  const markHit = useCallback((index: number) => {
    const view = pages.current[index];
    const want = wanted.current;
    if (!view) return;
    for (const old of view.text.querySelectorAll(".nx-find-hit")) {
      old.classList.remove("nx-find-hit");
    }
    if (!want || want.page !== index + 1) return;
    const span = spanFor(
      view.text.querySelectorAll("span"), want.query, want.occurrence,
    ) as HTMLElement | null;
    if (!span) return;
    span.classList.add("nx-find-hit");
    // `goTo` lands on the top of the page, and the match is somewhere
    // below it. Only in scroll mode: a page-mode page is the whole view.
    if (modeRef.current === "scroll") span.scrollIntoView({ block: "center" });
  }, []);

  // This document's own build stamp, not the project's: a build of another
  // preview must not make this pane re-fetch a PDF that has not changed.
  const stamp = useStore((s) => s.builds[showing]?.pdfStamp ?? s.pdfStamp);
  // Which of the three things a 404 means. `result` is null until a
  // `compile_done` has landed for this document, so it says whether this
  // has ever been built; `compiling` says whether one is running now.
  const compiling = useStore((s) => s.builds[showing]?.compiling ?? false);
  const result = useStore((s) => s.builds[showing]?.result ?? null);
  const outcome = result?.outcome;
  // A ref as well, because the fetch below reads it inside an async closure
  // that was started before the build state moved.
  const buildRef = useRef({ compiling, result: result ? { outcome } : null });
  buildRef.current = { compiling, result: result ? { outcome } : null };
  // The build wrote no PDF and the page on screen is the last good one:
  // where it stopped, for the line over the page.
  const stoppedAt = useMemo(() => {
    if (!result?.pdfKept) return null;
    const first = result.diagnostics.find((d) => d.severity === "error" && d.file);
    return first ? `${first.file}${first.line ? `:${first.line}` : ""}` : "";
  }, [result]);
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
    // The same document's text, only drawn at another size or turn: the
    // spans are rescaled where they are. Rebuilding them cost a round trip
    // to the worker and every span made again, on every visible page, at
    // every step of a zoom.
    const same = view.textLayer !== null && view.textDoc === document;
    view.textFor = mine;
    view.textScale = view.scale;
    try {
      const page = await document.getPage(index + 1);
      if (mine !== generation.current) return;
      const viewport = page.getViewport({ scale: view.scale, rotation: (page.rotate + view.rotation) % 360 });
      // Built at the committed scale, so any gesture transform is spent.
      view.text.style.transform = "";
      // pdf.js 6 sizes its spans and the layer by this; see the text
      // layer's rules in styles.css.
      view.text.style.setProperty("--total-scale-factor", String(view.scale));
      if (same && view.textLayer) {
        view.textLayer.update({ viewport });
        markHit(index);
        return;
      }
      view.textLayer = null;
      view.textDoc = null;
      view.text.replaceChildren();
      const content = await page.getTextContent();
      if (mine !== generation.current) return;
      const layer = new pdfjs.TextLayer({
        textContentSource: content,
        container: view.text,
        viewport,
      });
      await layer.render();
      if (mine !== generation.current) view.text.replaceChildren();
      else {
        view.textLayer = layer;
        view.textDoc = document;
        addEndOfContent(view.text);
        markHit(index);
      }
    } catch {
      // A page whose text cannot be read is still a page you can look at.
      view.textFor = -1;
      view.textLayer = null;
      view.textDoc = null;
    }
  }, [markHit]);

  /** A dark page, from the page just drawn: the figures are copied as
   *  they are onto a canvas of their own above it, then the page itself is
   *  drawn back through the dark filter, once, so scrolling costs nothing
   *  more than it did. */
  const darken = useCallback(
    async (
      page: pdfjs.PDFPageProxy,
      canvas: HTMLCanvasElement,
      layer: HTMLDivElement,
      viewport: pdfjs.PageViewport,
      context: CanvasRenderingContext2D,
    ): Promise<HTMLCanvasElement> => {
      const overlay = window.document.createElement("canvas");
      overlay.className = "nx-figures";
      layer.appendChild(overlay);
      overlay.width = canvas.width;
      overlay.height = canvas.height;
      const paint = overlay.getContext("2d");
      if (paint) {
        paint.clearRect(0, 0, overlay.width, overlay.height);
        try {
          const list = await page.getOperatorList();
          for (const box of figureBoxes(list.fnArray, list.argsArray as unknown[][], FIGURE_OPS)) {
            const at = onCanvas(viewport.transform, box, canvas.width, canvas.height);
            if (at) paint.drawImage(canvas, at.x, at.y, at.width, at.height, at.x, at.y, at.width, at.height);
          }
        } catch {
          // No figures found is a dark page with its figures dark too, which
          // is still a page to read.
        }
      }
      context.save();
      context.filter = "url(#nx-dark-page)";
      context.globalCompositeOperation = "copy";
      context.drawImage(canvas, 0, 0);
      context.restore();
      return overlay;
    },
    [],
  );

  const renderPage = useCallback(async (index: number) => {
    const view = pages.current[index];
    const document = doc.current;
    if (!view || !document) return;
    if (view.drawnFor === generation.current) return;   // already current
    if (view.task) return;                              // in flight
    const mine = generation.current;
    let fresh: HTMLDivElement | null = null;
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
      const turn = (page.rotate + view.rotation) % 360;
      const natural = page.getViewport({ scale: 1, rotation: turn });
      const viewport = page.getViewport({ scale: backing.width / natural.width, rotation: turn });
      const width = Math.floor(viewport.width);
      const height = Math.floor(viewport.height);
      // A new layer, sized once and never on screen until it is finished.
      // Hidden by opacity rather than taken out of the document, because
      // the dark page's filter is an SVG filter in this document, and a
      // canvas outside it cannot find it.
      fresh = window.document.createElement("div");
      fresh.className = "nx-page-layer";
      fresh.dataset.incoming = "";
      const canvas = window.document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      fresh.appendChild(canvas);
      view.container.insertBefore(fresh, view.text);
      const context = canvas.getContext("2d", { alpha: false });
      if (!context) return;
      const drawnAt = rasterKey(width / boxWidth);
      // `canvas: null` keeps the context above, which is opaque; pdf.js 6
      // would otherwise make its own from the canvas.
      view.task = page.render({ canvas: null, canvasContext: context, viewport });
      await view.task.promise;
      if (mine !== generation.current) return;
      const figures = darkRef.current ? await darken(page, canvas, fresh, viewport, context) : null;
      if (mine !== generation.current) return;
      show(view, fresh, canvas, figures);
      fresh = null;
      view.drawnAt = drawnAt;
      if (mine === generation.current) view.drawnFor = mine;
    } catch {
      /* superseded, or the page went away with the document */
    } finally {
      view.task = null;
      // A layer that was never shown goes with the render that made it.
      fresh?.remove();
    }
  }, [darken]);

  /** Give a page's pixels back: a canvas of zero size holds no backing
   *  store. Its box keeps its size, so nothing moves, and the page is drawn
   *  again when it comes near. */
  const release = (view: PageView) => {
    if (view.drawnFor === -1 && !view.task && !view.painted) return;
    view.task?.cancel();
    view.task = null;
    for (const layer of Array.from(view.container.querySelectorAll(".nx-page-layer"))) {
      if (layer !== view.layer) layer.remove();
    }
    view.canvas.width = 0;
    view.canvas.height = 0;
    if (view.figures) {
      view.figures.width = 0;
      view.figures.height = 0;
    }
    view.painted = false;
    view.drawnFor = -1;
    view.drawnAt = 0;
  };

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
    // The page being read is the one with the most of itself in view,
    // not the first one worth drawing: the drawing window reaches 400 px
    // above the view, so the first page in it was still the previous page
    // for the first 400 px of every page, and the number in the control
    // said so.  An agent turning the preview to page two landed the view
    // exactly at its top and the control went on saying one.  The share
    // of the page rather than the share of the view, so a short last page
    // scrolled fully into view wins over the tail of the page before it;
    // a tie, two pages both wholly in view, goes to the first.
    const viewTop = root.scrollTop;
    const viewBottom = root.scrollTop + root.clientHeight;
    let first = -1;
    let reading = -1;
    let mostShown = 0;
    const keep = root.clientHeight * KEEP_SCREENS;
    for (let index = 0; index < pages.current.length; index += 1) {
      const element = pages.current[index].container;
      const start = element.offsetTop;
      const end = start + element.offsetHeight;
      if (end < top - keep || start > bottom + keep) {
        release(pages.current[index]);
        continue;
      }
      if (end < top || start > bottom) continue;
      if (first < 0) first = index;
      const shown = Math.max(0, Math.min(end, viewBottom) - Math.max(start, viewTop));
      const share = element.offsetHeight ? shown / element.offsetHeight : 0;
      if (share > mostShown) {
        mostShown = share;
        reading = index;
      }
      renderPage(index);
      // A page a pinch reveals gets its picture now and its text when the
      // pinch ends: building several hundred spans is a hitch in the
      // middle of a gesture, and the commit rebuilds them at its scale
      // anyway.
      if (!zooming.current) renderText(index);
    }
    const now = reading >= 0 ? reading : first;
    if (now >= 0 && now + 1 !== currentRef.current) setCurrent(now + 1);
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

  // A drag across the page's text keeps its selection over the gaps
  // between lines, and a copy carries the words as the page reads them:
  // see pdf-select.ts. Installed once for the whole page.
  useEffect(() => guardSelection(), []);

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

  // The width the pages were last fitted to, and the width a page gets from
  // a pane that wide: two pages side by side share it, less the gap.
  const fittedFor = useRef(0);
  const widthFor = (pane: number) => {
    const across = spreadRef.current ? 2 : 1;
    return (pane - 48 - (across - 1) * 16) / across;
  };

  // ---- laying the document out ------------------------------------------
  const layout = useCallback(
    async (document: pdfjs.PDFDocumentProxy, keep: boolean) => {
      const container = sheet.current;
      if (!container) return;
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
      const turn = rotationRef.current;
      const natural = first.getViewport({ scale: 1, rotation: (first.rotate + turn) % 360 });
      const measured = scroller.current?.clientWidth ?? 0;
      const available = widthFor(measured > 80 ? measured : 900);
      fittedFor.current = measured > 80 ? measured : 900;
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
      // Where the reader is, read after the awaits rather than before them.
      // A pinch that went on through them had scrolled by the time they
      // returned, and putting back the place from before pulled the page
      // out from under the fingers.
      const position = keep ? anchor() : { index: 0, fraction: 0 };
      const views: PageView[] = [];
      for (let index = 0; index < count; index += 1) {
        const page = sheets[index];
        const base = page.getViewport({ scale: 1, rotation: (page.rotate + turn) % 360 });
        const upright = page.getViewport({ scale: 1 });
        const { width, height } = boxAt({ baseWidth: base.width, baseHeight: base.height }, effective);
        if (reusable) {
          const view = pages.current[index];
          view.task?.cancel();
          view.task = null;
          view.width = width;
          view.height = height;
          view.scale = effective;
          view.naturalWidth = upright.width;
          view.naturalHeight = upright.height;
          view.rotation = turn;
          view.baseWidth = base.width;
          view.baseHeight = base.height;
          view.container.style.width = `${width}px`;
          view.container.style.height = `${height}px`;
          views.push(view);
          continue;
        }
        const element = window.document.createElement("div");
        element.className = "nx-page";
        element.style.width = `${width}px`;
        element.style.height = `${height}px`;
        const layer = window.document.createElement("div");
        layer.className = "nx-page-layer";
        const canvas = window.document.createElement("canvas");
        canvas.width = 0;
        canvas.height = 0;
        layer.appendChild(canvas);
        element.appendChild(layer);
        const text = window.document.createElement("div");
        text.className = "nx-text-layer";
        element.appendChild(text);
        views.push({
          container: element, layer, canvas, painted: false, text, width, height,
          scale: effective, drawnFor: -1, drawnAt: 0, textFor: -1, textScale: 0, textLayer: null, textDoc: null, task: null,
          figures: null, naturalWidth: upright.width, naturalHeight: upright.height, rotation: turn,
          baseWidth: base.width, baseHeight: base.height,
        });
      }

      pages.current = views;
      setPageCount(count);

      // A new page count means new page elements, which have nothing drawn
      // on them.  The old pages are lifted into a still copy of the view,
      // held over the new ones until the pages in view are drawn, and then
      // faded away, so a rebuild that adds a page is the same quiet swap
      // as one that does not.
      let ghost: HTMLDivElement | null = null;
      if (!reusable) {
        for (const view of pages.current) view.task?.cancel();
        const root = scroller.current;
        const was = root ? { top: root.scrollTop, left: root.scrollLeft } : null;
        if (root && was && container.childElementCount) {
          ghost = window.document.createElement("div");
          ghost.className = "nx-sheet-ghost";
          ghost.setAttribute("aria-hidden", "true");
          const copy = container.cloneNode(false) as HTMLDivElement;
          copy.removeAttribute("data-testid");
          copy.style.position = "absolute";
          copy.style.width = `${container.offsetWidth}px`;
          copy.style.left = `${container.offsetLeft - was.left}px`;
          copy.style.top = `${container.offsetTop - was.top}px`;
          copy.append(...Array.from(container.children));
          ghost.appendChild(copy);
        }
        const fragment = window.document.createDocumentFragment();
        for (const view of views) fragment.appendChild(view.container);
        container.replaceChildren(fragment);
      }
      applyMode(modeRef.current);
      restore(position);
      const root = scroller.current;
      if (ghost && root) {
        ghost.style.top = `${root.scrollTop}px`;
        ghost.style.left = `${root.scrollLeft}px`;
        ghost.style.width = `${root.clientWidth}px`;
        ghost.style.height = `${root.clientHeight}px`;
        root.appendChild(ghost);
      }
      try {
        // The canvases still hold the previous render until this resolves, so
        // the pane shows the old page rather than a blank one.
        await renderPage(Math.min(position.index, count - 1));
        if (ghost && root) {
          const top = root.scrollTop;
          const bottom = top + root.clientHeight;
          await Promise.all(
            views.map((view, index) => {
              const start = view.container.offsetTop;
              const end = start + view.container.offsetHeight;
              return end < top || start > bottom ? null : renderPage(index);
            }),
          );
        }
      } finally {
        if (ghost) {
          const leaving = ghost;
          leaving.dataset.leaving = "";
          const gone = () => leaving.remove();
          leaving.addEventListener("transitionend", gone, { once: true });
          window.setTimeout(gone, swapDuration() + 60);
        }
      }
      if (superseded()) return;
      drawVisible();
    },
    [anchor, drawVisible, renderPage, restore, scale],
  );

  /** In page mode only one page is in the flow; in scroll mode all are. */
  const applyMode = useCallback((next: Mode) => {
    const index = currentRef.current - 1;
    // Two pages side by side in page mode are the pair the current page
    // is in: one and two, three and four, as a printed book opens.
    const pair = spreadRef.current ? index - (index % 2) : index;
    pages.current.forEach((view, position) => {
      const shown = next === "scroll" || position === index ||
        (spreadRef.current && (position === pair || position === pair + 1));
      view.container.style.display = shown ? "block" : "none";
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
          // Checked on the failure paths as well as the success one. The
          // success path was hardened and these two were left, so a
          // superseded fetch could still write its answer over a newer
          // one's: a stale 404 arriving after a good PDF had loaded put
          // the "no preview" screen over a page that was on the screen.
          if (cancelled) return;
          // A 503 is the route saying a build is rewriting the file at
          // this moment.  A page already on screen is better than any
          // notice, and the build's own `compile_done` bumps the stamp,
          // so the fetch is simply given up on.
          if (response.status === 503 && doc.current) return;
          setAbsence(absenceFrom(response, buildRef.current, Boolean(source) || anyDocumentRef.current));
          return;
        }
        const data = await response.arrayBuffer();
        if (cancelled) return;
        const loaded = await pdfjs.getDocument({ data, worker: pdfWorker() }).promise;
        if (cancelled) {
          // Destroyed through its loading task: pdf.js 6 took `destroy`
          // off the document itself.
          void loaded.loadingTask.destroy();
          return;
        }
        const previous = doc.current;
        doc.current = loaded;
        setAbsence("");
        await layoutRef.current(loaded, previous !== null);
        void previous?.loadingTask.destroy();
      } catch {
        // Never got an answer at all, which is not the same as being told
        // there is nothing to show.
        if (cancelled) return;
        setAbsence(absenceFrom(null, buildRef.current));
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
    writeStored("nexttex.pdf.zoom", String(scale));
  }, [scale]);

  // Two pages side by side and a turn change the layout; the dark page
  // changes only how each page is drawn.
  const shownOnce = useRef(false);
  useEffect(() => {
    writeStored("nexttex.pdf.spread", spread ? "1" : "0");
    writeStored("nexttex.pdf.rotation", String(rotation));
    if (!shownOnce.current) {
      shownOnce.current = true;
      return;
    }
    if (doc.current) layoutRef.current(doc.current, true);
  }, [spread, rotation]);

  useEffect(() => {
    writeStored("nexttex.pdf.dark", dark ? "1" : "0");
    if (doc.current) invalidateRaster();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dark]);

  useEffect(() => {
    writeStored("nexttex.pdf.mode", mode);
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
  // While the width is moving, as it does through a pane's slide, the pages
  // follow it frame by frame the way a pinch resizes them, by their boxes,
  // with what is drawn stretched to fit; the crisp re-fit comes once the
  // width has settled.  Without that the page kept the old width's size
  // for the whole slide and jumped at the end.
  //
  // Settled means, for a slide, the frame the last pane stops in, not a
  // guess at it.  A 120 ms quiet after the last resize let pdf.js draw in
  // the middle of a move whose frames came slower than that, and otherwise
  // drew 300 ms after the move, with the page stretched and soft until it
  // did.  A drag on a divider has no end the motion knows of, so it keeps
  // the quiet.
  useEffect(() => {
    const root = scroller.current;
    if (!root) return;
    let timer = 0;
    let frame = 0;
    let unwait: () => void = () => undefined;
    const observer = new ResizeObserver((entries) => {
      // A pane that has just been collapsed reports zero width; re-fitting
      // to that would leave a page 35% wide when it comes back.
      const now = entries[0]?.contentRect.width ?? 0;
      if (now < 80) return;
      if (!scale && fittedFor.current > 80 && drawn.current) {
        const live = drawn.current * (widthFor(now) / widthFor(fittedFor.current));
        for (const view of pages.current) {
          if (!view.scale) continue;
          const size = boxAt(view, live);
          view.container.style.width = `${size.width}px`;
          view.container.style.height = `${size.height}px`;
          view.text.style.transform = `scale(${live / view.scale})`;
        }
      }
      window.clearTimeout(timer);
      window.cancelAnimationFrame(frame);
      unwait();
      const settle = () => {
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
      };
      if (panesMoving()) {
        // The frame after the rest, so the row has been laid out at it.
        unwait = whenPanesRest(() => {
          frame = window.requestAnimationFrame(settle);
        });
      } else {
        timer = window.setTimeout(settle, 120);
      }
    });
    observer.observe(root);
    return () => {
      observer.disconnect();
      window.clearTimeout(timer);
      window.cancelAnimationFrame(frame);
      unwait();
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
  // And the gesture must not redraw the document sixty times a second.
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
    // instead and applied once per frame, and that frame lays the document
    // out once: the boxes are written, the one page the pointer is on is
    // measured, and the scroll that follows invalidates nothing.
    let pending: { deltaY: number; x: number; y: number } | null = null;
    let frame = 0;

    // The point the gesture holds still: a page, and where on it the
    // pointer was, as fractions of its box.  Found once and kept while the
    // pointer stays where it is, so a long gesture cannot drift by finding
    // it again from a box rounded to whole pixels every frame.
    let held: { index: number; fx: number; fy: number; x: number; y: number } | null = null;

    /** The page under a point on the screen, or the nearest one to it. */
    const pageAt = (x: number, y: number) => {
      let best: { index: number; fx: number; fy: number; x: number; y: number } | null = null;
      let nearest = Infinity;
      pages.current.forEach((view, index) => {
        if (!view.container.offsetHeight) return;   // hidden in page mode
        const box = view.container.getBoundingClientRect();
        const away = Math.hypot(
          Math.max(box.left - x, 0, x - box.right),
          Math.max(box.top - y, 0, y - box.bottom),
        );
        if (away >= nearest) return;
        nearest = away;
        best = { index, fx: (x - box.left) / box.width, fy: (y - box.top) / box.height, x, y };
      });
      return best;
    };

    const apply = () => {
      frame = 0;
      const gesture = pending;
      pending = null;
      if (!gesture) return;

      const from = liveScale.current || drawn.current || 1;
      const next = Math.min(
        MAX_ZOOM,
        Math.max(MIN_ZOOM, +(from * Math.exp(-gesture.deltaY * 0.002)).toFixed(3)),
      );
      if (next === from) return;
      liveScale.current = next;

      // --- the read before anything is written: where the pointer is ---
      if (!held || Math.abs(held.x - gesture.x) > 0.5 || Math.abs(held.y - gesture.y) > 0.5) {
        held = pageAt(gesture.x, gesture.y);
      }

      // --- the boxes, at the one rounding the layout uses ---
      for (const view of pages.current) {
        if (!view.scale) continue;
        const size = boxAt(view, next);
        view.container.style.width = `${size.width}px`;
        view.container.style.height = `${size.height}px`;
        // The text is positioned in pixels computed at the scale it was
        // built for, so without this it stays where it was while the page
        // grows under it and a selection made mid-gesture lands a word
        // out.  A transform rather than a rebuild: rebuilding several
        // hundred spans per frame is a cost no frame can afford.
        view.text.style.transform = `scale(${next / view.scale})`;
      }

      // --- then where the held point landed, and the scroll that puts it
      // back under the pointer ---
      // Measured, not predicted.  This scaled the scroll offset by the
      // zoom's ratio, as though everything above the pointer grew with the
      // pages, but the padding and the gaps between pages do not, nor does
      // a page centred in a pane wider than it.  Five pages down that was
      // 38 px of slide over one pinch, and with each frame's box rounded to
      // a whole pixel it shimmered as it went.  The read is the layout the
      // frame needs anyway, and the scroll writes after it invalidate
      // nothing.
      if (held) {
        const view = pages.current[held.index];
        if (view) {
          const box = view.container.getBoundingClientRect();
          root.scrollLeft += toShell(box.left + held.fx * box.width - held.x);
          root.scrollTop += toShell(box.top + held.fy * box.height - held.y);
        }
      }
      showZoom(next);

      window.clearTimeout(commit.current);
      commit.current = window.setTimeout(() => {
        zooming.current = false;
        held = null;
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
      if (!frame) frame = window.requestAnimationFrame(apply);
    };

    const onTouchEnd = () => {
      if (!spread) return;
      spread = 0;
      // The fingers have lifted, so there is nothing left to wait for.
      window.clearTimeout(commit.current);
      commit.current = window.setTimeout(() => {
        zooming.current = false;
        held = null;
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
    async (event: PagePoint) => {
      const projectId = get().projectId;
      if (!projectId) return;
      // A figure has no source file behind it, so there is nothing to jump
      // to.  Asking anyway would run an inverse search against the main
      // document and land the caret on an unrelated line.
      if (source) return;
      const target = (event.target as HTMLElement).closest(".nx-page") as HTMLElement | null;
      if (!target) return;
      const index = pages.current.findIndex((view) => view.container === target);
      if (index < 0) return;
      // The word under the pointer and the page's text around it, read from
      // the text layer rather than from the selection the second click
      // made: Chromium selects nothing on a one-letter span, which is all
      // of maths, and the matcher needs the neighbours to tell one "the"
      // in a paragraph from another. See pdf-click.ts.
      const span = (event.target as HTMLElement).closest(".nx-text-layer span") as
        | HTMLElement
        | null;
      const layer = span?.closest(".nx-text-layer") as HTMLElement | null;
      const hint = span && layer
        ? textAtPoint(layer, span, event.clientX, event.clientY) ?? undefined
        : undefined;
      const box = target.getBoundingClientRect();
      // SyncTeX works in PDF points from the top-left corner, and so does
      // the canvas, so the conversion is the scale factor and nothing else.
      // Less the page's one pixel border, which the rectangle includes and
      // the canvas does not.
      const across = (event.clientX - box.left - target.clientLeft) / drawn.current;
      // Asked at the middle of the span the click landed in rather than at
      // the pointer.  A heading's synctex box ends at its baseline, so a
      // click in the lower part of its glyphs, which is where a pointer
      // aimed at a big word lands, was answered with the paragraph beneath
      // it; the middle of the span is inside the box for a heading and for
      // a body line alike.
      const middle = span ? span.getBoundingClientRect() : null;
      const clientY = middle ? middle.top + middle.height / 2 : event.clientY;
      const down = (clientY - box.top - target.clientTop) / drawn.current;
      // Back to the page as TeX set it, upright, when it is shown turned.
      const view = pages.current[index];
      const { x, y } = view
        ? fromTurned(view.rotation, view.naturalWidth, view.naturalHeight, across, down)
        : { x: across, y: down };
      try {
        const result = await api.inverse(projectId, index + 1, x, y, showing);
        if (result.found && result.file && result.line) {
          onNavigate(result.file, result.line, hint);
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

  /** A page the agent asked for before the document had that many. */
  const wantedPage = useRef<number | null>(null);

  const goTo = useCallback(
    (page: number) => {
      const want = Math.min(Math.max(page, 1), pageCount || 1);
      if (modeRef.current === "page") {
        setCurrent(want);
        return;
      }
      const element = pages.current[want - 1]?.container;
      const root = scroller.current;
      if (element && root) root.scrollTop = element.offsetTop;
    },
    [pageCount],
  );

  useEffect(() => {
    handleRef({
      goTo: (page: number) => {
        if (pageCount >= page) {
          wantedPage.current = null;
          goTo(page);
        } else {
          wantedPage.current = page;
        }
      },
      reveal: async (path: string, line: number, gentle = false) => {
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
          const box = boxOnTurned(view.rotation, view.naturalWidth, view.naturalHeight, position);
          // Both modes need this and they need different arithmetic, which
          // is why it is here rather than in the caller: in page mode there
          // is one page on screen and the question is whether it is this
          // one, and in scroll mode the question is whether the box is
          // inside the part of the document the reader can see.
          const top = view.container.offsetTop + box.top * zoom;
          const alreadyInFront =
            modeRef.current === "page"
              ? currentRef.current === position.page
              : top >= root.scrollTop &&
                top <= root.scrollTop + root.clientHeight - 24;
          if (gentle && alreadyInFront) {
            // The reader is already looking at it. Flash it, because
            // something did change there, and move nothing.
            flash(view, position, zoom);
            return true;
          }
          if (modeRef.current === "page") {
            setCurrent(position.page);
            await renderPage(position.page - 1);
          } else {
            root.scrollTo({
              top: Math.max(view.container.offsetTop + box.top * zoom - root.clientHeight / 3, 0),
            });
          }
          flash(view, position, zoom);
          return true;
        } catch {
          return false;
        }
      },
    });
    // `showing` for the same reason as the handler above: forward search
    // would look up a line in whichever document was open when this was
    // last built.
  }, [handleRef, renderPage, showing, pageCount, goTo]);

  // A page asked for before the document had it: the count has moved.
  useEffect(() => {
    const want = wantedPage.current;
    if (want !== null && pageCount >= want) {
      wantedPage.current = null;
      goTo(want);
    }
  }, [pageCount, goTo]);

  // ---- keyboard, in page mode ------------------------------------------
  /** Put page n on screen, in whichever mode is showing.
   *
   *  In page mode the effect on `current` draws it; in scroll mode there
   *  is nothing to draw, only somewhere to be, so this scrolls the page's
   *  own container to the top of the view. The scroll handler then sets
   *  `current` from what it finds, which keeps one answer to "which page
   *  is this" rather than two that can disagree.
   */
  const step = useCallback(
    (delta: number) => goTo((currentRef.current || 1) + delta),
    [goTo],
  );

  /** The footer's minus and plus, and the page menu's Zoom out and in. */
  const zoomBy = (delta: number) =>
    setScale((value) =>
      Math.min(
        MAX_ZOOM,
        Math.max(MIN_ZOOM, +((value === -1 ? pageFitScale : value || fitScale) + delta).toFixed(2)),
      ),
    );

  /** The footer's Download and the page menu's Download PDF. */
  const savePdf = () => {
    if (!projectId) return;
    void download(
      api.pdfUrl(projectId, showing, stamp),
      showing ? `${stemOf(showing)}.pdf` : "document.pdf",
      "the PDF",
    );
  };

  /** Go to one hit: the page first, then the mark once the layer is there. */
  const showHit = useCallback((index: number, list: PageHit[], needle: string) => {
    const hit = list[index];
    if (!hit) {
      wanted.current = null;
      pages.current.forEach((_, page) => markHit(page));
      return;
    }
    wanted.current = { page: hit.page, occurrence: hit.occurrence, query: needle };
    goTo(hit.page);
    // A layer already built for this generation will not be rebuilt, so
    // it is marked now; one that is not yet built marks itself when it is.
    const view = pages.current[hit.page - 1];
    pages.current.forEach((_, page) => {
      if (page !== hit.page - 1) markHit(page);
    });
    if (view && view.textFor === generation.current) markHit(hit.page - 1);
  }, [goTo, markHit]);

  // The search itself, a moment after the typing stops. The first search
  // after a build extracts every page's text and keeps it.
  useEffect(() => {
    if (!finding) return;
    let cancelled = false;
    const timer = setTimeout(async () => {
      const document = doc.current;
      const needle = query.trim();
      if (!document || !needle) {
        setHits([]);
        setAt(0);
        showHit(-1, [], "");
        return;
      }
      const mine = generation.current;
      if (!pageTexts.current || pageTexts.current.generation !== mine) {
        let texts: string[];
        try {
          // Every page at once, as the layout reads them: one after another
          // the first find in a long document waited on each page's round
          // trip to the worker in turn (Q-032).
          texts = await Promise.all(
            Array.from({ length: document.numPages }, async (_, index) => {
              const page = await document.getPage(index + 1);
              const content = await page.getTextContent();
              return textOf(content.items as { str: string; hasEOL?: boolean }[]);
            }),
          );
        } catch {
          return;
        }
        if (cancelled || mine !== generation.current) return;
        pageTexts.current = { generation: mine, texts };
      }
      if (cancelled) return;
      const found = findIn(pageTexts.current.texts, needle);
      setHits(found);
      setAt(0);
      showHit(0, found, needle);
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [finding, query, stamp, showHit]);

  const stepHit = useCallback((delta: number) => {
    if (!hits.length) return;
    const next = (at + delta + hits.length) % hits.length;
    setAt(next);
    showHit(next, hits, query);
  }, [at, hits, query, showHit]);

  // The caret goes into the box when the bar opens, and only then. The
  // first version did this in an inline ref callback, which React calls
  // again on every commit, so every scroll and every zoom while the bar
  // was open pulled the caret back out of the page and into the input.
  useEffect(() => {
    if (finding) findBox.current?.focus();
  }, [finding]);

  const closeFind = useCallback(() => {
    setFinding(false);
    setHits([]);
    showHit(-1, [], "");
    scroller.current?.focus();
  }, [showHit]);

  return (
    <div className="flex h-full min-h-0 flex-col bg-surround">
      {finding ? (
        // Above the page rather than in the footer: the editor's own find
        // sits at the top of its pane, and the footer is a 26px strip that
        // already drops controls at narrow widths.
        // The same strip the editor's find is: the field with the icon,
        // the count, previous and next, and the close, on the second
        // surface, so the two finds read as one feature.
        <div
          className="flex h-10 shrink-0 items-center gap-1.5 bg-surface-2 px-2.5"
          data-testid="pdf-find-bar"
        >
          <Field
            ref={findBox}
            frameClassName="h-7 min-w-0 flex-1 !bg-surface"
            leading={<SearchIcon size={14} />}
            placeholder="Find on the page"
            data-testid="pdf-find"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                stepHit(event.shiftKey ? -1 : 1);
              }
              if (event.key === "Escape") {
                event.preventDefault();
                event.stopPropagation();
                closeFind();
              }
            }}
          />
          <span
            className={`t-meta tnum shrink-0 ${query.trim() && !hits.length ? "text-warn" : "text-ink-3"}`}
            data-testid="pdf-find-count"
          >
            {query.trim()
              ? hits.length ? `${at + 1} of ${hits.length}` : "Nothing found"
              : ""}
          </span>
          <IconButton label="Previous match" onClick={() => stepHit(-1)} disabled={!hits.length}>
            <ChevronUpIcon size={14} />
          </IconButton>
          <IconButton label="Next match" onClick={() => stepHit(1)} disabled={!hits.length}>
            <ChevronDownIcon size={14} />
          </IconButton>
          <IconButton label="Close find" onClick={closeFind} data-testid="pdf-find-close">
            <CloseIcon size={14} />
          </IconButton>
        </div>
      ) : null}
      {stoppedAt !== null && !source ? (
        // A fatal build wrote no PDF, and the page below is the last one
        // that built (Q-066). One line, on the second surface like the
        // find strip, with the one thing to do about it.
        <div
          className="t-meta flex h-8 shrink-0 items-center gap-2 bg-surface-2 pl-3 pr-2 text-ink-2"
          data-testid="pdf-kept"
        >
          <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-error" aria-hidden />
          <span className="min-w-0 truncate">
            The last page that built. This build stopped
            {stoppedAt ? <> at <span className="t-code-sm text-ink-3">{stoppedAt}</span></> : null}
          </span>
          <span className="flex-1" />
          {onOpenBuild ? (
            <Button variant="quiet" onClick={onOpenBuild}>Show the error</Button>
          ) : null}
        </div>
      ) : null}
      <div
        ref={scroller}
        className="relative min-h-0 flex-1 overflow-auto"
        onScroll={mode === "scroll" ? onScroll : undefined}
        onDoubleClick={onDoubleClick}
        onContextMenu={(event) => {
          // The footer's controls at the pointer, and the double-click's
          // jump to the source.  Not over a selection, whose Copy is the
          // browser's menu's, and not before there is a page to act on.
          if (!pageCount || !claimsRightClick(event)) return;
          const selection = window.getSelection();
          if (selection && !selection.isCollapsed && scroller.current?.contains(selection.anchorNode)) return;
          event.preventDefault();
          const keyboard = event.clientX === 0 && event.clientY === 0;
          const box = scroller.current?.getBoundingClientRect();
          setPageMenu({
            // From the keyboard there is no pointer: the menu opens near
            // the page's top corner rather than the window's.
            at: keyboard && box
              ? { left: toShell(box.left) + 24, top: toShell(box.top) + 24 }
              : atPointer(event, null, 230),
            point: !keyboard && (event.target as HTMLElement).closest(".nx-page")
              ? { target: event.target, clientX: event.clientX, clientY: event.clientY }
              : null,
          });
        }}
        tabIndex={0}
        onKeyDown={(event) => {
          // Before the mode gate below, or the bar never opens in the
          // mode most people read in. Only while the preview holds the
          // keyboard, which it does after a click on a page: Mod-F in
          // the editor is the editor's own find and stays that.
          if ((event.metaKey || event.ctrlKey) && event.code === "KeyF") {
            event.preventDefault();
            setFinding(true);
            // The box may not exist yet; when it does, its ref takes the
            // caret. A second press selects what is there.
            findBox.current?.select();
            return;
          }
          if (mode !== "page") return;
          if (event.key === "ArrowRight" || event.key === "PageDown") step(1);
          if (event.key === "ArrowLeft" || event.key === "PageUp") step(-1);
        }}
      >
        {absence === "building" ? (
          <div className="flex h-full items-center justify-center px-8 text-center">
            <div className="max-w-[42ch]">
              <p className="t-display text-ink-2">Typesetting.</p>
              <p className="t-meta mt-2 text-ink-2">
                The first build of a project takes a few seconds. The page
                appears here when it lands.
              </p>
            </div>
          </div>
        ) : null}
        {absence === "unbuilt" ? (
          <div className="flex h-full items-center justify-center px-8 text-center">
            <div className="max-w-[42ch]">
              <p className="t-display text-ink-2">Not built yet.</p>
              <p className="t-meta mt-2 text-ink-2">
                Nothing has been typeset for this document in this session.
                Write a line, or build it, and the page appears here.
              </p>
            </div>
          </div>
        ) : null}
        {absence === "empty" ? (
          <div className="flex h-full items-center justify-center px-8 text-center">
            <div className="max-w-[42ch]">
              <p className="t-display text-ink-2">Nothing has been typeset yet.</p>
              <p className="t-meta mt-2 text-ink-2">
                An empty document produces no pages. Write a line and it will
                appear here about a second later, or start from something
                that already works.
              </p>
              {onLoadTemplate ? (
                <Button variant="ghost" className="mt-4" onClick={onLoadTemplate}>
                  Load a basic document
                </Button>
              ) : null}
            </div>
          </div>
        ) : null}
        {absence === "stopped" ? (
          <div className="flex h-full items-center justify-center px-8 text-center">
            <div className="max-w-[42ch]">
              <p className="t-display text-ink-2">The build stopped before a page was made.</p>
              <p className="t-meta mt-2 text-ink-2">
                The Build drawer says where and why. The page appears here as
                soon as the document builds.
              </p>
              {onOpenBuild ? (
                <Button variant="ghost" className="mt-4" onClick={onOpenBuild}>
                  Show the error
                </Button>
              ) : null}
            </div>
          </div>
        ) : null}
        {absence === "nodocument" ? (
          <div className="flex h-full items-center justify-center px-8 text-center">
            <div className="max-w-[42ch]">
              <p className="t-display text-ink-2">No document to preview.</p>
              <p className="t-meta mt-2 text-ink-2">
                A file with a \documentclass and a \begin{"{"}document{"}"} of
                its own is a document, and none is on the strip. One that
                went to the trash comes back from there; a new one is offered
                under + as soon as it exists.
              </p>
              {onLoadTemplate ? (
                <Button variant="ghost" className="mt-4" onClick={onLoadTemplate}>
                  Start a basic document
                </Button>
              ) : null}
            </div>
          </div>
        ) : null}
        {absence === "unreachable" ? (
          <div className="flex h-full items-center justify-center px-8 text-center">
            <div className="max-w-[42ch]">
              <p className="t-display text-ink-2">The preview could not be fetched.</p>
              <p className="t-meta mt-2 text-ink-2">
                Your document is not the problem, and nothing has been lost.
                This tries again after the next build.
              </p>
            </div>
          </div>
        ) : null}
        <div
          ref={sheet}
          data-testid="pdf-sheet"
          data-dark-page={dark || undefined}
          data-spread={spread || undefined}
          data-rotation={rotation || undefined}
          className={
            spread
              ? "flex w-full flex-row flex-wrap content-start justify-center gap-4 px-6 py-4"
              : "flex w-fit min-w-full flex-col items-center gap-4 px-6 py-4"
          }
          style={{
            ...(spread ? {} : { justifyContent: "safe center" }),
            ["--dark-page-ground" as string]: darkGround,
          }}
        />
        {dark ? <DarkPageFilter /> : null}
      </div>

      {/* The page's right-click menu: the footer's controls, grouped as the
          footer groups them, so every one of them is in reach at a pane
          width where the footer has dropped it, with the double-click's
          jump to the source first.  A choice the footer shows as a
          segmented pair is a pair of the kit's radio rows here, as the
          composer's model menu draws a one-of choice; the View menu's
          switches keep their checks.  `nx-menu-mixed` lines the radio
          rows' labels up with the rows that carry an icon. */}
      <Menu
        open={pageMenu !== null}
        className="nx-menu-mixed"
        onClose={() => setPageMenu(null)}
        wanted={pageMenu?.at ?? null}
        label="The page"
        testid="pdf-context-menu"
        width={230}
      >
        {pageMenu ? (() => {
          const run = (fn: () => void) => () => {
            setPageMenu(null);
            fn();
          };
          const mark = (on: boolean) => (on ? <CheckIcon size={14} /> : <span className="inline-block w-3.5" />);
          const point = pageMenu.point;
          const fit = scale === 0 ? "width" : scale === -1 ? "page" : "free";
          return (
            <>
              {point && !source ? (
                <>
                  <MenuItem icon={<span className="inline-block w-3.5" />} onClick={run(() => void onDoubleClick(point))}>
                    Show this in the source
                  </MenuItem>
                  <MenuDivider />
                </>
              ) : null}
              {mode === "page" ? (
                <>
                  <MenuItem icon={<span className="inline-block w-3.5" />} disabled={current <= 1} onClick={run(() => step(-1))}>
                    Previous page
                  </MenuItem>
                  <MenuItem icon={<span className="inline-block w-3.5" />} disabled={current >= pageCount} onClick={run(() => step(1))}>
                    Next page
                  </MenuItem>
                  <MenuDivider />
                </>
              ) : null}
              <MenuItem icon={<span className="inline-block w-3.5" />} onClick={run(() => zoomBy(0.15))}>Zoom in</MenuItem>
              <MenuItem icon={<span className="inline-block w-3.5" />} onClick={run(() => zoomBy(-0.15))}>Zoom out</MenuItem>
              <MenuItem role="menuitemradio" aria-checked={fit === "width"}
                onClick={run(() => setScale(0))}>
                Fit width
              </MenuItem>
              <MenuItem role="menuitemradio" aria-checked={fit === "page"}
                onClick={run(() => setScale(-1))}>
                Fit page
              </MenuItem>
              <MenuDivider />
              <MenuItem role="menuitemradio" aria-checked={mode === "scroll"}
                onClick={run(() => setMode("scroll"))}>
                Scroll
              </MenuItem>
              <MenuItem role="menuitemradio" aria-checked={mode === "page"}
                onClick={run(() => setMode("page"))}>
                One page at a time
              </MenuItem>
              <MenuDivider />
              <MenuItem role="menuitemcheckbox" aria-checked={dark} icon={mark(dark)} onClick={run(() => setDark(!dark))}>
                Dark page
              </MenuItem>
              <MenuItem role="menuitemcheckbox" aria-checked={spread} icon={mark(spread)} onClick={run(() => setSpread(!spread))}>
                Two pages side by side
              </MenuItem>
              <MenuItem icon={<span className="inline-block w-3.5" />} onClick={run(() => setRotation(nextRotation(rotation)))}>
                Rotate a quarter turn
              </MenuItem>
              {rotation !== 0 ? (
                <MenuItem icon={<span className="inline-block w-3.5" />} onClick={run(() => setRotation(0))}>Back upright</MenuItem>
              ) : null}
              <MenuDivider />
              <MenuItem icon={<span className="inline-block w-3.5" />} onClick={run(() => {
                setFinding(true);
                findBox.current?.select();
              })}>
                Find in the preview
              </MenuItem>
              {projectId ? (
                <>
                  <MenuDivider />
                  <MenuItem icon={<span className="inline-block w-3.5" />} onClick={run(savePdf)}>Download PDF</MenuItem>
                </>
              ) : null}
            </>
          );
        })() : null}
      </Menu>

      {/* The strip under the preview: 28 px on the second surface with no
          rule above it, like the status strip it sits beside, so the two
          read as one edge along the bottom of the window.  Scroll and Page
          and the two fits are the kit's small segmented control; the page
          number and the zoom are wells on the pane's surface; Download is
          the one plain action at the right. */}
      <div
        data-testid="preview-footer"
        className="nx-foot @container t-meta flex h-7 shrink-0 items-center gap-4 overflow-hidden whitespace-nowrap bg-surround px-3 text-ink-2"
      >
        {/* What the strip drops as the pane narrows, in the order it drops
            them, each at the width the row measures with it: the fit pair
            first (566), then Download (440), then View (372), then this
            layout pair (340), leaving the pager and the zoom, which a page
            always needs. View is kept past Download because the Download
            drawer saves the PDF too, and nothing else turns the page.  A
            28 px strip cannot wrap, so a control it cannot hold is dropped
            rather than clipped. */}
        <span className="hidden shrink-0 @[340px]:inline-flex">
          <Segmented
            size="sm"
            label="How the pages are laid out"
            value={mode}
            options={[
              { value: "scroll", label: "Scroll", title: "One continuous document" },
              { value: "page", label: "Page", title: "One page at a time" },
            ]}
            onChange={setMode}
          />
        </span>
        {/* Both modes. The steppers were gated on page mode, so a reader
            in the scrolling one had no way to reach page 74 of a thesis
            except by dragging, and the readout was never an input in
            either. A page number is the one coordinate a long document
            has, and which mode you are reading in has nothing to do with
            whether you can name it. */}
        <span className="flex shrink-0 items-center gap-1">
          <Pressable
            className="nx-tap [--nx-tap-y:28px] flex h-5 w-5 items-center justify-center text-ink-2 hover:text-ink disabled:text-ink-3"
            disabled={current <= 1}
            onClick={() => step(-1)}
            aria-label="Previous page"
          >
            <ChevronLeftIcon size={12} />
          </Pressable>
          {pageCount ? (
            <span className="flex items-center gap-1">
              <Input
                type="number"
                min={1}
                max={pageCount}
                value={current}
                aria-label="Page"
                data-testid="page-number"
                className="nx-strip-field w-10.5"
                onChange={(event) => {
                  const want = Number(event.target.value);
                  if (Number.isFinite(want) && want >= 1) goTo(want);
                }}
              />
              <span className="tnum">of {pageCount}</span>
            </span>
          ) : (
            <span className="tnum w-23 text-center">–</span>
          )}
          <Pressable
            className="nx-tap [--nx-tap-y:28px] flex h-5 w-5 items-center justify-center text-ink-2 hover:text-ink disabled:text-ink-3"
            disabled={current >= pageCount}
            onClick={() => step(1)}
            aria-label="Next page"
          >
            <ChevronRightIcon size={12} />
          </Pressable>
        </span>
        <span className="flex shrink-0 items-center gap-1">
          <Pressable
            className="nx-tap [--nx-tap-y:28px] flex h-5 w-5 items-center justify-center text-ink-2 hover:text-ink"
            onClick={() => zoomBy(-0.15)}
            aria-label="Zoom out"
          >
            −
          </Pressable>
          <span ref={zoomText} className="nx-strip-field w-11" data-testid="zoom" />
          <Pressable
            className="nx-tap [--nx-tap-y:28px] flex h-5 w-5 items-center justify-center text-ink-2 hover:text-ink"
            onClick={() => zoomBy(0.15)}
            aria-label="Zoom in"
          >
            +
          </Pressable>
        </span>
        <span className="hidden shrink-0 @[566px]:inline-flex">
          <Segmented
            size="sm"
            label="How the page fits the pane"
            value={scale === 0 ? "width" : scale === -1 ? "page" : "free"}
            options={[
              { value: "width", label: "Fit width" },
              { value: "page", label: "Fit page" },
            ]}
            onChange={(fit) => setScale(fit === "width" ? 0 : -1)}
          />
        </span>
        <span className="min-w-0 flex-1" />
        {/* How the page is shown: dark, two at a time, turned. One button
            with a short menu, because three more controls would crowd a
            strip that already drops some as the pane narrows. Named View
            rather than Page, which the layout pair beside it already says. */}
        <Pressable
          ref={viewButton}
          type="button"
          className={`hidden shrink-0 items-center gap-1 whitespace-nowrap hover:text-ink @[372px]:flex ${viewMenu ? "text-ink" : ""}`}
          aria-haspopup="menu"
          aria-expanded={viewMenu !== null}
          data-testid="pdf-view"
          onClick={() => {
            if (viewMenu) {
              setViewMenu(null);
              return;
            }
            // Hung from the button's right edge and flipped above it, since
            // the strip is the foot of the window.
            const wanted = under(viewButton.current, 230, "right");
            if (wanted) setViewMenu({ left: wanted.left, top: wanted.top, flip: wanted.flip ?? wanted.top });
          }}
        >
          View <ChevronUpIcon size={10} />
        </Pressable>
        <Menu
          open={viewMenu !== null}
          onClose={() => setViewMenu(null)}
          wanted={viewMenu}
          anchor={viewButton}
          label="How the page is shown"
          testid="pdf-view-menu"
          width={230}
        >
          <MenuItem
            role="menuitemcheckbox"
            aria-checked={dark}
            icon={dark ? <CheckIcon size={14} /> : <span className="inline-block w-3.5" />}
            data-testid="pdf-dark"
            onClick={() => {
              setViewMenu(null);
              setDark(!dark);
            }}
          >
            Dark page
          </MenuItem>
          <MenuItem
            role="menuitemcheckbox"
            aria-checked={spread}
            icon={spread ? <CheckIcon size={14} /> : <span className="inline-block w-3.5" />}
            data-testid="pdf-spread"
            onClick={() => {
              setViewMenu(null);
              setSpread(!spread);
            }}
          >
            Two pages side by side
          </MenuItem>
          <MenuDivider />
          <MenuItem
            icon={<span className="inline-block w-3.5" />}
            data-testid="pdf-rotate"
            onClick={() => {
              setViewMenu(null);
              setRotation(nextRotation(rotation));
            }}
          >
            Rotate a quarter turn
          </MenuItem>
          <MenuItem
            icon={<span className="inline-block w-3.5" />}
            data-testid="pdf-upright"
            disabled={rotation === 0}
            onClick={() => {
              setViewMenu(null);
              setRotation(0);
            }}
          >
            Back upright
          </MenuItem>
        </Menu>
        {/* The page that is already rendered and already on disk. The
            Download drawer is the only other way to save it and its PDF
            chip forces a full server rebuild first, which is a wait for a
            file the reader is looking at.  Fetched rather than linked,
            like every other download: see `download` in chrome.tsx for
            what a link does here. The name has to be made up because this
            route sends no Content-Disposition: a bare `download` attribute
            falls back to the URL's last segment, so this saved the page as
            `pdf.pdf`, the browser having added the extension itself. */}
        {projectId && pageCount ? (
          <Pressable
            type="button"
            className="hidden shrink-0 whitespace-nowrap hover:text-ink @[440px]:block"
            onClick={savePdf}
            data-testid="save-pdf"
            title="Save this PDF as it stands, without rebuilding it"
          >
            Download
          </Pressable>
        ) : null}
      </div>
    </div>
  );
}
