import { Suspense, lazy, useEffect, useMemo, useRef, useState } from "react";
import api from "../api";
import { download } from "../chrome";
import { useStore } from "../store";
import { kindOf } from "./file-kinds";
import { fitScale, nextStep } from "./image-zoom";

const Pdf = lazy(() => import("./Pdf"));

/** A file the editor cannot open, shown rather than refused.
 *
 *  This exists because of history, not in spite of it.  A replaced figure
 *  keeps its previous versions, and the only route to a file's history is
 *  to make it the active document -- which, for a PNG, meant asking the
 *  editor to read bytes as text and failing.  Byte-safe history without
 *  this is history nobody can reach.
 *
 *  It used to say, in this docstring, that it was "deliberately not a
 *  viewer: no zoom, no pan, no page controls".  That was the wrong call and
 *  it is reversed here rather than left to contradict the code.  Two things
 *  changed the answer.  A figure is not an attachment, it is the object the
 *  writer is judging, and judging it means seeing it at a size they choose.
 *  And the file this app was least able to show was the PDF -- which is the
 *  format figures are kept in precisely because it scales -- while the
 *  application had PDF.js loaded one column away the whole time.
 *
 *  So: PDFs go to the preview pane's own viewer, given a URL instead of the
 *  build; images get zoom, fit and their real dimensions; and everything
 *  else still gets the honest card that says what it is and offers the one
 *  thing worth doing to it.
 */

export function readableSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function ImageView({ source, name, path }: { source: string; name: string; path: string }) {
  const projectId = useStore((s) => s.projectId);
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null);
  // `null` is fit-to-pane, which is where a figure should start: the first
  // question is always what it looks like whole.
  const [zoom, setZoom] = useState<number | null>(null);
  const [frameSize, setFrameSize] = useState<{ width: number; height: number } | null>(null);
  const frame = useRef<HTMLDivElement | null>(null);

  // A different file is a different picture, and it starts fitted again.
  useEffect(() => {
    setNatural(null);
    setZoom(null);
  }, [source]);

  // The frame's size, kept current: dragging a handle or folding a pane
  // changes what fits, and a fitted figure follows.  `clientWidth` rather
  // than the observer's box, because it is what the scroll box can show.
  useEffect(() => {
    const element = frame.current;
    if (!element) return;
    const measure = () =>
      setFrameSize({ width: element.clientWidth, height: element.clientHeight });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const fit = natural && frameSize ? fitScale(frameSize, natural) : 1;
  const shown = zoom ?? fit;
  /** One rung along from what is on screen.  A fit with no rung beyond it
   *  in that direction stays as it is, and stays Fit rather than becoming
   *  a number that means the same thing. */
  const stepFrom = (current: number | null, from: number, by: 1 | -1): number | null => {
    const now = current ?? from;
    const next = nextStep(now, by);
    return next === now ? current : next;
  };
  return (
    <>
      <div
        ref={frame}
        className="flex min-h-0 flex-1 items-center justify-center overflow-auto bg-surround p-5"
      >
        {/* On paper, and with the page's own shadow, for the same reason
            the typeset page has both: a figure is a thing being printed,
            and a plot exported with a transparent background -- which is
            most of them -- was being judged against near-black in the dark
            theme, where a white axis label simply is not there.  Paper is
            also the honest preview: white is what transparent will be. */}
        {/* `.nx-page` is the typeset page's own recipe -- paper, a hairline,
            and the theme's page shadow -- and a figure gets it rather than a
            second description of the same thing. */}
        <div className="nx-page shrink-0">
          <img
            src={source}
            alt={name}
            onLoad={(event) =>
              setNatural({
                w: event.currentTarget.naturalWidth,
                h: event.currentTarget.naturalHeight,
              })
            }
            // Always an explicit width once the size is known, never a
            // percentage: see `fitScale`.  Before the load answers there
            // is nothing to size, and a guess would be drawn and replaced.
            style={
              natural
                ? { width: Math.max(1, Math.round(natural.w * shown)), display: "block" }
                : { display: "block", visibility: "hidden" }
            }
          />
        </div>
      </div>
      <div className="flex h-[26px] shrink-0 items-center gap-3 overflow-hidden whitespace-nowrap border-t border-line bg-surface-2 px-[10px]">
        {natural ? (
          <span className="t-micro tnum text-ink-3">
            {natural.w} &times; {natural.h}
          </span>
        ) : null}
        <span className="ml-auto flex items-center gap-1">
          <button
            className="nx-tap [--nx-tap-y:26px] nx-hover t-micro px-1 text-ink-2 hover:text-ink"
            aria-label="Zoom out"
            data-testid="image-zoom-out"
            onClick={() => setZoom((current) => stepFrom(current, fit, -1))}
          >
            &minus;
          </button>
          <span className="t-micro tnum w-[38px] text-center text-ink-3" data-testid="image-zoom">
            {zoom === null ? "Fit" : `${Math.round(zoom * 100)}%`}
          </span>
          <button
            className="nx-tap [--nx-tap-y:26px] nx-hover t-micro px-1 text-ink-2 hover:text-ink"
            aria-label="Zoom in"
            data-testid="image-zoom-in"
            onClick={() => setZoom((current) => stepFrom(current, fit, 1))}
          >
            +
          </button>
        </span>
        {/* A rule and the footer's own gap between `+` and Fit, as the
            page's footer has between its `+` and "Fit width".  The tap
            area `nx-tap` draws is 44px wide around a 14px sign, and with
            the two words 4px apart it lay over Fit, so a press on Fit was
            answered by `+`, and Fit's own tap area, drawn later, took
            presses meant for `+`.  Fit is `quiet` now, a word that is its
            own target with the row's height for a finger, and the rule
            puts the sign's reach short of it. */}
        <Rule />
        <button
          className="quiet t-micro shrink-0"
          data-testid="image-fit"
          data-tone={zoom === null ? "on" : undefined}
          onClick={() => setZoom(null)}
        >
          Fit
        </button>
        {/* The file as it is on disk, beside the picture of it.  The
            card for a file nobody can draw has had this from the start;
            a figure only had the tree's row menu, which is not where a
            person looking at the figure is looking. */}
        {projectId ? (
          <a
            className="quiet t-micro shrink-0"
            href={api.downloadUrl(projectId, { path })}
            download
            data-testid="image-download"
            title={`Download ${name}`}
          >
            Download
          </a>
        ) : null}
      </div>
    </>
  );
}

function Rule() {
  return <span className="h-[10px] w-px shrink-0 bg-line" />;
}

export default function FileView({
  path,
  size,
  source: given,
}: {
  path: string;
  size?: number;
  /** The bytes to show, when they are not the ones currently at `path`.
   *
   *  This is how an old version of a figure is looked at.  `path` still
   *  decides which viewer to reach for and what to call the file, because
   *  a version of a PNG is a PNG; only where the bytes come from changes.
   *  Without it the only way to see version three of a plot was a 180px
   *  thumbnail inside a 264px panel, and for a PDF figure there was no way
   *  at all -- while the viewer that could have shown it was one pane
   *  away. */
  source?: string;
}) {
  const projectId = useStore((s) => s.projectId);
  const stamp = useStore((s) => s.pdfStamp);
  const name = path.split("/").pop() ?? path;
  const kind = kindOf(path);
  const source = useMemo(
    () =>
      given ??
      (projectId ? `${api.downloadUrl(projectId, { path })}&at=${stamp}` : ""),
    [given, projectId, path, stamp],
  );

  if (kind === "pdf" && source) {
    return (
      <div className="flex h-full min-h-0 flex-col" data-testid="file-view">
        <Suspense fallback={<div className="flex-1 bg-surround" />}>
          {/* The preview pane's viewer, pointed at a file instead of at the
              build.  Not a second implementation: a figure deserves the
              same rasteriser, the same zoom ladder and the same page
              controls as the document it is going into, and there is no
              version of "a smaller, simpler PDF viewer" that is not just a
              worse one. */}
          <Pdf
            source={source}
            handleRef={() => undefined}
            onNavigate={() => undefined}
          />
        </Suspense>
      </div>
    );
  }

  if (kind === "image" && source) {
    return (
      <div className="flex h-full min-h-0 flex-col" data-testid="file-view">
        <ImageView source={source} name={name} path={path} />
      </div>
    );
  }

  return (
    <div
      className="flex h-full min-h-0 flex-col items-center justify-center bg-surround p-4"
      data-testid="file-view"
    >
      <p className="t-meta text-ink-3">
        {name}
        {size ? ` · ${readableSize(size)}` : ""}
      </p>
      <button
        className="ghost-button mt-3 h-[28px] px-3 t-ui"
        onClick={() =>
          projectId && void download(api.downloadUrl(projectId, { path }), name)
        }
      >
        Download
      </button>
    </div>
  );
}
