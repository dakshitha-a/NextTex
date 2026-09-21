/** The small pieces of the application's own frame.
 *
 *  Their own module because five panes were importing `Chevron` out of
 *  `App.tsx`, which made the two thousand line root component a dependency
 *  of half the interface and pointed every one of those files at the
 *  largest thing in the build to get a chevron. None of what follows knows
 *  anything about the application: they are a menu, two icons, a fold
 *  control, a segmented toggle and a drag handle.
 */


import api, { saveBlob } from "./api";
import { set } from "./store";
import { IconButton } from "./ui/Button";
import { Segmented as KitSegmented } from "./ui/controls";

/** Sharing, as a glyph: two people, and the line between them.
 *
 *  Drawn rather than fetched, like the cog beside it, so the interface
 *  carries no icon font and no sprite sheet.  Every attribute is quoted --
 *  an unquoted one ending in a slash swallows the tag's own close and the
 *  path draws nothing at all, which has happened here before.
 */
export function ShareIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 16 16" aria-hidden="true">
      <g
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
      >
        <circle cx="12.2" cy="3.4" r="2.1" />
        <circle cx="3.8" cy="8" r="2.1" />
        <circle cx="12.2" cy="12.6" r="2.1" />
        <path d="M5.65 6.99 L10.35 4.41" />
        <path d="M5.65 9.01 L10.35 11.59" />
      </g>
    </svg>
  );
}

/** A copy of this, to keep: the arrow and the shelf it lands on. */
export function DownloadIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 16 16" aria-hidden="true">
      <g
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M8 1.9 L8 9.6" />
        <path d="M4.7 6.5 L8 9.8 L11.3 6.5" />
        <path d="M2.6 12.4 L2.6 13.7 L13.4 13.7 L13.4 12.4" />
      </g>
    </svg>
  );
}

/** The formats pandoc writes, in the order the chips sit, with the
 *  suffix the chip shows. */
export const EXPORTS: readonly { format: string; suffix: string; says: string }[] = [
  { format: "docx", suffix: ".docx", says: "Word" },
  { format: "html", suffix: ".html", says: "HTML" },
  { format: "md", suffix: ".md", says: "Markdown" },
];

/** Every copy the project can give lives in the Download drawer,
 *  `panes/DownloadPanel.tsx`, which draws a chip per format from EXPORTS
 *  above and fetches through the functions below; the menu that used to
 *  hang from the title bar's button went with the bar (item 2.3 of the
 *  frame run). */
/** A document's stem, which is what its PDF is called. */
export function stemOf(path: string): string {
  return (path.split("/").pop() ?? path).replace(/\.(tex|ltx)$/i, "");
}

/** A PDF download can fail, the document may not typeset, and a plain link
 *  would save the error as a .pdf.  Fetching first lets it say why.  The
 *  file is named after the document, never the project: the server says
 *  which in Content-Disposition, which is the one source for the name when
 *  no document was asked for and the one on screen was sent. */
export async function downloadPdf(projectId: string, document = "") {
  try {
    const response = await fetch(
      api.downloadUrl(projectId, { format: "pdf", document }),
      { credentials: "same-origin" },
    );
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      throw new Error(body.detail || "the document did not typeset");
    }
    const header = response.headers.get("content-disposition") ?? "";
    const named = /filename="?([^";]+)"?/.exec(header)?.[1];
    const fallback = document ? `${stemOf(document)}.pdf` : "document.pdf";
    saveBlob(await response.blob(), named || fallback);
  } catch (error: any) {
    set({ error: `Could not download the PDF: ${error.message}` });
  }
}

/** A file the server serves as an attachment, fetched by the page and
 *  saved, rather than handed to the browser as a link.
 *
 *  Every download was a plain `<a download>` link, and from inside an
 *  open project over HTTPS the browser cancelled such a download before
 *  sending a byte once the page had been open about ten seconds: the ZIP,
 *  a single file, a PDF, all the same, reproducibly, with nothing in the
 *  server log, while the same link from the project list and a `fetch`
 *  of the same URL from the same page at the same moment both went
 *  through.  What Chrome's download manager objects to in that state was
 *  not established; what is established is which road works, and it is
 *  the one the PDF download had always taken because it needed to say
 *  why a document did not typeset.  So every download takes it: the name
 *  is what `Content-Disposition` says, or the caller's fallback, and a
 *  refusal is a sentence in the corner rather than a file called
 *  `download`.  `what` is the noun for that sentence. */
export async function download(url: string, fallback: string, what = "the file") {
  try {
    const response = await fetch(url, { credentials: "same-origin" });
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      throw new Error(body.detail || body.error || `the server answered ${response.status}`);
    }
    const header = response.headers.get("content-disposition") ?? "";
    const named = /filename="?([^";]+)"?/.exec(header)?.[1];
    saveBlob(await response.blob(), named || fallback);
  } catch (error: any) {
    set({ error: `Could not download ${what}: ${error.message}` });
  }
}

/** The whole project as a ZIP, by the road above. */
export function downloadZip(projectId: string, fallback = "project.zip") {
  return download(api.downloadUrl(projectId, { format: "zip" }), fallback, "the project");
}

/** A document as Word, HTML or Markdown, through pandoc on the server;
 *  a refusal is pandoc's own sentence in the corner. */
export function downloadExport(projectId: string, document: string, format: string) {
  const suffix = EXPORTS.find((entry) => entry.format === format)?.suffix ?? `.${format}`;
  return download(
    api.downloadUrl(projectId, { format, document }),
    `${stemOf(document)}${suffix}`,
    "the converted document",
  );
}

/** A plus, drawn rather than typed.  The `+` glyph sits on the baseline
 *  of whatever font is in force and is never centred in a square box;
 *  two strokes crossing at the middle of the viewBox are. */
export function PlusIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 11 11" aria-hidden="true">
      <g fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round">
        <path d="M5.5 1 L5.5 10" />
        <path d="M1 5.5 L10 5.5" />
      </g>
    </svg>
  );
}

/** A run mark, and its stop.  The same triangle the file tree draws on a
 *  script's sheet, so the row, the control and the tab say one thing. */
export function RunIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
      <path d="M2 1.2v7.6L8.4 5z" fill="currentColor" />
    </svg>
  );
}

export function StopIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
      <rect x="1.5" y="1.5" width="7" height="7" rx="1" fill="currentColor" />
    </svg>
  );
}

/** One chevron drawing, so the app speaks one language of arrows. */
export function Chevron({
  direction = "left",
}: {
  direction?: "left" | "right" | "up" | "down";
}) {
  const path = {
    left: "M6 1 L2 5 L6 9",
    right: "M2 1 L6 5 L2 9",
    up: "M1 6 L5 2 L9 6",
    down: "M1 2 L5 6 L9 2",
  }[direction];
  const size = direction === "left" || direction === "right" ? [8, 10] : [10, 8];
  return (
    <svg width={size[0]} height={size[1]} viewBox={direction === "left" || direction === "right" ? "0 0 8 10" : "0 0 10 8"} aria-hidden>
      <path d={path} fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** A padded fold control, so it is a button rather than punctuation. */
export function FoldButton({
  direction,
  label,
  onClick,
}: {
  direction: "left" | "right";
  label: string;
  onClick: () => void;
}) {
  return (
    <IconButton label={label} className="!w-[22px] shrink-0" onClick={onClick}>
      <Chevron direction={direction} />
    </IconButton>
  );
}

export function Segmented({
  value,
  onChange,
}: {
  value: "source" | "preview";
  onChange: (value: "source" | "preview") => void;
}) {
  // The kit's Segmented: a group of two buttons with a pressed state, not
  // a tablist, because there is no panel associated with either and no
  // arrow-key navigation between them.
  return (
    <KitSegmented
      label="Show the source or the preview"
      testid="view-toggle"
      className="mr-2 shrink-0"
      value={value}
      options={[
        { value: "source", label: "Source" },
        { value: "preview", label: "Preview" },
      ]}
      onChange={onChange}
    />
  );
}

export function Handle({
  onPointerDown,
  onReset,
  axis = "column",
}: {
  onPointerDown: (e: React.PointerEvent) => void;
  onReset?: () => void;
  /** `column` divides two panes side by side; `row` divides them top and
   *  bottom.  The diagnostics drawer had its own copy of this rather than an
   *  axis, which is how it ended up with a bare three pixel target and none
   *  of the fixes the pane dividers had learned. */
  axis?: "column" | "row";
}) {
  const row = axis === "row";
  return (
    <div
      className={`nx-handle relative shrink-0 ${
        row ? "h-px w-full cursor-row-resize" : "w-px cursor-col-resize"
      }`}
      // Invisible at rest: the panes separate by tone, and the writer
      // found a line drawn between them unnecessary.  It shows in the hint
      // colour while the pointer rests on it and for the length of a
      // drag, marked on the element itself since the pointer leaves the
      // handle as soon as the drag begins.
      onPointerDown={(event) => {
        const handle = event.currentTarget;
        handle.dataset.dragging = "true";
        const clear = () => {
          delete handle.dataset.dragging;
          window.removeEventListener("pointerup", clear);
          window.removeEventListener("pointercancel", clear);
        };
        window.addEventListener("pointerup", clear);
        window.addEventListener("pointercancel", clear);
        onPointerDown(event);
      }}
      onDoubleClick={onReset}
    >
      {/* The visible line is one pixel; this is what the pointer actually
          has to hit.  Nine pixels is a comfortable mouse target and a poor
          finger one, so on a coarse pointer it widens to twenty-four.  The
          divider does not move and nothing reflows: only the area that
          answers a press changes.

          `z-10`, and this is the whole of R-111. The zone hangs half over
          each neighbouring pane, and the pane on one side is CodeMirror,
          which paints its own content in a later stacking context. A press
          on the overhanging half therefore landed in the editor: it
          selected text and dragged a selection across it, and the rail did
          not move at all. Two sweep shots that should have differed showed
          the same 240 pixel rail and a text selection in the editor as the
          only change between them.

          `select-none` for the other half of that: the pointer is being
          dragged across a text layer with the button down, and even with
          the press caught here the browser will still start a selection in
          whatever is under it unless told not to. */}
      <span
        className={
          row
            ? "absolute -top-1 left-0 z-10 w-full h-[9px] select-none [@media(pointer:coarse)]:-top-3 [@media(pointer:coarse)]:h-[24px]"
            : "absolute -left-1 top-0 z-10 h-full w-[9px] select-none [@media(pointer:coarse)]:-left-3 [@media(pointer:coarse)]:w-[24px]"
        }
      />
    </div>
  );
}
