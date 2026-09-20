/** The small pieces of the application's own frame.
 *
 *  Their own module because five panes were importing `Chevron` out of
 *  `App.tsx`, which made the two thousand line root component a dependency
 *  of half the interface and pointed every one of those files at the
 *  largest thing in the build to get a chevron. None of what follows knows
 *  anything about the application: they are a menu, two icons, a fold
 *  control, a segmented toggle and a drag handle.
 */

import { useMemo, useRef, useState } from "react";

import api, { saveBlob } from "./api";
import { set, useStore } from "./store";
import { under } from "./place-menu";
import { Menu, MenuDivider } from "./ui/Menu";
import { Button, IconButton } from "./ui/Button";
import { Segmented as KitSegmented } from "./ui/controls";
import Settings from "./panes/Settings";

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

/** The ways out of a project, behind one button.
 *
 *  A menu rather than a dialog: there is nothing to decide, only which
 *  thing to fetch, and a card with a heading would be more ceremony than
 *  the act deserves.  One row for the whole project, then one row per
 *  document, the ones on the preview strip first, then the ones that are
 *  not, which the route builds on the spot.  Each row ends in a chip per
 *  format: `.zip` for the project, `.pdf` for a document and, on a
 *  machine with pandoc, `.docx` `.html` `.md` beside it.  It was a
 *  column before, the PDF row and three indented export rows under it
 *  per document, which on a resume project with twenty variants was
 *  eighty rows; the writer asked for the format to be chosen on the row,
 *  the way the projects screen's Zip and PDF sit on theirs.  Chips
 *  rather than a fly-out: a second popup needs hover intent, its own
 *  placing and its own contrast test, for a choice one word wide.  The
 *  role is kept: focus on open, arrows walk the grid, Escape back to
 *  the button.
 */
/** The formats pandoc writes, in the order the chips sit, with the
 *  suffix the chip shows. */
export const EXPORTS: readonly { format: string; suffix: string; says: string }[] = [
  { format: "docx", suffix: ".docx", says: "Word" },
  { format: "html", suffix: ".html", says: "HTML" },
  { format: "md", suffix: ".md", says: "Markdown" },
];

/** One format on a row.  A control, so it is drawn as one: ink-2 at
 *  rest and a wash on hover, the projects screen's Zip and PDF exactly,
 *  and measured as a control by the contrast spec. */
function Chip({ label, title, testid, document, format, onChoose }: {
  label: string;
  title: string;
  testid: string;
  document?: string;
  format?: string;
  onChoose: () => void;
}) {
  return (
    <button
      role="menuitem"
      data-testid={testid}
      data-document={document}
      data-format={format}
      title={title}
      className="nx-chip nx-chip-mono shrink-0 !bg-transparent hover:!bg-wash hover:text-ink focus:!bg-wash focus:text-ink focus:outline-none"
      onPointerMove={(event) => {
        if (event.movementX || event.movementY) event.currentTarget.focus();
      }}
      onClick={onChoose}
    >
      {label}
    </button>
  );
}

export function DownloadMenu({ onZip, onPdf, onExport }: {
  onZip: () => void;
  onPdf: (document: string) => void;
  /** Word, HTML or Markdown through pandoc; the rows are drawn only when
   *  the machine has pandoc, which `/api/tools` says once per load. */
  onExport?: (document: string, format: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement | null>(null);
  // Hung from the button's left edge: the button sits near the left of
  // the rail, and a column wide enough for a file name hung from its right
  // edge started off screen.  Measured once per opening.
  const wanted = useMemo(() => (open ? under(trigger.current, 320, "left") : null), [open]);
  const previews = useStore((s) => s.previews);
  const candidates = useStore((s) => s.candidates);
  const pandoc = useStore((s) => s.tools?.pandoc === true);
  const documents = [...previews, ...candidates.filter((path) => !previews.includes(path))];

  const choose = (what: () => void) => () => {
    setOpen(false);
    what();
  };
  const row = "flex w-full items-center gap-[4px] px-[10px] py-[2px] text-ink";

  return (
    <div className="relative flex items-center">
      {/* A labelled quiet button, as the title bar draws it on the page. */}
      <Button
        ref={trigger}
        aria-label="Download a copy"
        title="Download a copy"
        aria-haspopup="menu"
        aria-expanded={open}
        data-testid="open-download"
        onClick={() => setOpen((value) => !value)}
      >
        <DownloadIcon /> Download
      </Button>
      {/* The kit's menu with the grid walk: a row per document, a chip per
          format, 320 wide so a stem gets a readable run beside four chips. */}
      <Menu
        open={open}
        onClose={() => setOpen(false)}
        wanted={wanted}
        anchor={trigger}
        testid="download-menu"
        width={320}
        grid
      >
          <div role="none" data-menu-row data-testid="download-row" className={row}>
            <span className="t-ui min-w-0 flex-1 truncate">Whole project</span>
            <Chip
              label=".zip"
              title="The whole project as a zip"
              testid="download-zip"
              onChoose={choose(onZip)}
            />
          </div>
          {documents.length ? <MenuDivider /> : null}
          {documents.map((path) => (
            <div
              key={path}
              role="none"
              data-menu-row
              data-testid="download-row"
              data-document={path}
              className={row}
            >
              <span className="t-ui min-w-0 flex-1 truncate" title={path}>
                {stemOf(path)}
              </span>
              <Chip
                label=".pdf"
                title={`${path} typeset`}
                testid="download-pdf"
                document={path}
                onChoose={choose(() => onPdf(path))}
              />
              {/* The same document as Word, HTML or Markdown, only on a
                  machine with pandoc: a chip that can only fail is not
                  offered. */}
              {pandoc && onExport
                ? EXPORTS.map((entry) => (
                    <Chip
                      key={entry.format}
                      label={entry.suffix}
                      title={`${path} as ${entry.says}`}
                      testid="download-export"
                      document={path}
                      format={entry.format}
                      onChoose={choose(() => onExport(path, entry.format))}
                    />
                  ))
                : null}
            </div>
          ))}
      </Menu>
    </div>
  );
}

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

export function AppControls({
  projectId,
  projectName,
  onSwitch,
  onTutorial,
  onChangeAgent,
  settingsNonce = 0,
}: {
  projectId: string | null;
  projectName: string;
  onSwitch: () => void;
  /** The palette's way of opening the settings sheet; see `Settings`. */
  settingsNonce?: number;
  /** Handed through rather than left out.  This bar exists because the rail
   *  folded away, and the rail folds by itself below 1100px -- which is a
   *  tablet, which this app is meant to be used on.  Without these the
   *  settings on a tablet were two rows short of the settings on a laptop:
   *  no way to open the tutorial and no way to change the agent, on the
   *  screens where somebody is most likely to want the tutorial. */
  onTutorial?: () => void;
  onChangeAgent?: () => void;
}) {
  return (
    <div className="flex shrink-0 items-center gap-1 pr-1">
      <Button className="max-w-[200px] !text-ink" onClick={onSwitch} title="Switch project">
        <span className="truncate">{projectName}</span>
        <Chevron direction="down" />
      </Button>
      <Settings
        inProject
        onTutorial={onTutorial}
        onChangeAgent={onChangeAgent}
        openNonce={settingsNonce}
      />
      {/* The same control as the rail's, because this is the same bar with
          the file list folded away, and two toolbars that disagree about
          where downloads live is worse than either arrangement. */}
      <DownloadMenu
        onZip={() =>
          projectId && void downloadZip(projectId)
        }
        onPdf={(document) => projectId && downloadPdf(projectId, document)}
        onExport={(document, format) => projectId && void downloadExport(projectId, document, format)}
      />
    </div>
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
      onPointerDown={onPointerDown}
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
