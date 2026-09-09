import { Suspense, lazy, useEffect, useMemo, useRef, useState } from "react";
import api from "../api";
import { startDownload } from "../api";
import { useStore } from "../store";
import { kindOf } from "./file-kinds";

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

/** The zoom ladder, and it is the preview pane's, deliberately.  Two
 *  viewers a keystroke apart that step through different numbers would be
 *  two viewers; these are meant to be one thing that can show two kinds of
 *  file. */
const STEPS = [0.25, 0.5, 0.75, 1, 1.5, 2, 3];

function nextStep(from: number, by: 1 | -1): number {
  const near = STEPS.reduce((best, step) =>
    Math.abs(step - from) < Math.abs(best - from) ? step : best,
  );
  const index = STEPS.indexOf(near);
  return STEPS[Math.min(Math.max(index + by, 0), STEPS.length - 1)];
}

function ImageView({ source, name }: { source: string; name: string }) {
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null);
  // `null` is fit-to-pane, which is where a figure should start: the first
  // question is always what it looks like whole.
  const [zoom, setZoom] = useState<number | null>(null);
  const frame = useRef<HTMLDivElement | null>(null);

  // A different file is a different picture, and it starts fitted again.
  useEffect(() => {
    setNatural(null);
    setZoom(null);
  }, [source]);

  const shown = zoom ?? 1;
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
        <div
          className="nx-page shrink-0"
          style={{ background: "var(--paper)", boxShadow: "var(--page-shadow)" }}
        >
          <img
            src={source}
            alt={name}
            onLoad={(event) =>
              setNatural({
                w: event.currentTarget.naturalWidth,
                h: event.currentTarget.naturalHeight,
              })
            }
            style={
              zoom === null
                ? { maxWidth: "100%", maxHeight: "100%", display: "block" }
                : natural
                  ? { width: natural.w * shown, display: "block" }
                  : { display: "block" }
            }
          />
        </div>
      </div>
      <div className="nx-furniture flex h-[26px] shrink-0 items-center gap-3 overflow-hidden whitespace-nowrap border-t border-line bg-surface-2 px-[10px]">
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
            onClick={() => setZoom((current) => nextStep(current ?? 1, -1))}
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
            onClick={() => setZoom((current) => nextStep(current ?? 1, 1))}
          >
            +
          </button>
          <button
            className="nx-tap [--nx-tap-y:26px] nx-hover t-micro px-1 text-ink-2 hover:text-ink"
            data-testid="image-fit"
            onClick={() => setZoom(null)}
          >
            Fit
          </button>
        </span>
      </div>
    </>
  );
}

export default function FileView({ path, size }: { path: string; size?: number }) {
  const projectId = useStore((s) => s.projectId);
  const stamp = useStore((s) => s.pdfStamp);
  const name = path.split("/").pop() ?? path;
  const kind = kindOf(path);
  const source = useMemo(
    () =>
      projectId
        ? `${api.downloadUrl(projectId, { path })}&at=${stamp}`
        : "",
    [projectId, path, stamp],
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
        <ImageView source={source} name={name} />
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
          projectId && startDownload(api.downloadUrl(projectId, { path }))
        }
      >
        Download
      </button>
    </div>
  );
}
