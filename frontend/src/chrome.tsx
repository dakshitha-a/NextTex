/** The small pieces of the application's own frame.
 *
 *  Their own module because five panes were importing `Chevron` out of
 *  `App.tsx`, which made the two thousand line root component a dependency
 *  of half the interface and pointed every one of those files at the
 *  largest thing in the build to get a chevron. None of what follows knows
 *  anything about the application: they are a menu, two icons, a fold
 *  control, a segmented toggle and a drag handle.
 */

import { useRef, useState } from "react";

import api, { saveBlob, startDownload } from "./api";
import { set } from "./store";
import { useDismiss } from "./useDismiss";
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

/** The two ways out of a project, behind one button.
 *
 *  A menu rather than a dialog: there is nothing to decide, only which of
 *  two things to fetch, and a card with a heading would be more ceremony
 *  than the act deserves.
 */
export function DownloadMenu({
  onZip,
  onPdf,
}: {
  onZip: () => void;
  onPdf: () => void;
}) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement | null>(null);
  const menu = useRef<HTMLDivElement | null>(null);
  useDismiss(menu, open, () => setOpen(false), trigger);

  const choose = (what: () => void) => () => {
    setOpen(false);
    what();
  };

  return (
    <div className="relative flex items-center">
      <button
        ref={trigger}
        aria-haspopup="menu"
        aria-expanded={open}
        title="Download a copy"
        aria-label="Download a copy"
        data-testid="open-download"
        className="quiet flex h-[26px] w-[26px] items-center justify-center rounded-[3px] hover:bg-surface-3"
        onClick={() => setOpen((value) => !value)}
      >
        <DownloadIcon />
      </button>
      {open ? (
        <div
          ref={menu}
          role="menu"
          data-testid="download-menu"
          className="nx-furniture nx-arrive absolute top-[30px] right-0 z-40 w-[176px] rounded-[5px] border border-line bg-surface py-[3px] shadow-float"
        >
          <button
            role="menuitem"
            data-testid="download-zip"
            className="t-ui block w-full px-[10px] py-[5px] text-left text-ink hover:bg-surface-2"
            onClick={choose(onZip)}
          >
            Whole project
            <span className="t-micro ml-[6px] text-ink-3">.zip</span>
          </button>
          <button
            role="menuitem"
            data-testid="download-pdf"
            className="t-ui block w-full px-[10px] py-[5px] text-left text-ink hover:bg-surface-2"
            onClick={choose(onPdf)}
          >
            Typeset page
            <span className="t-micro ml-[6px] text-ink-3">.pdf</span>
          </button>
        </div>
      ) : null}
    </div>
  );
}

/** A PDF download can fail -- the document may not typeset -- and a plain
 *  link would save the error as a .pdf.  Fetching first lets it say why. */
export async function downloadPdf(projectId: string, name: string) {
  try {
    const response = await fetch(api.downloadUrl(projectId, { format: "pdf" }), {
      credentials: "same-origin",
    });
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      throw new Error(body.detail || "the project did not typeset");
    }
    saveBlob(await response.blob(), `${name || "project"}.pdf`);
  } catch (error: any) {
    set({ error: `Could not download the PDF: ${error.message}` });
  }
}

export function AppControls({
  projectId,
  projectName,
  onSwitch,
  onTutorial,
  onChangeAgent,
}: {
  projectId: string | null;
  projectName: string;
  onSwitch: () => void;
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
      <button
        className="quiet t-meta flex h-[26px] max-w-[200px] items-center gap-1 rounded-[3px] px-2 font-serif hover:bg-surface-3"
        onClick={onSwitch}
        title="Switch project"
      >
        <span className="truncate text-ink">{projectName}</span>
        <Chevron direction="down" />
      </button>
      <Settings
        inProject
        onTutorial={onTutorial}
        onChangeAgent={onChangeAgent}
      />
      {/* The same control as the rail's, because this is the same bar with
          the file list folded away, and two toolbars that disagree about
          where downloads live is worse than either arrangement. */}
      <DownloadMenu
        onZip={() =>
          projectId && startDownload(api.downloadUrl(projectId, { format: "zip" }))
        }
        onPdf={() => projectId && downloadPdf(projectId, projectName)}
      />
    </div>
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
    <button
      className="quiet flex h-[26px] w-[22px] shrink-0 items-center justify-center rounded-[3px] hover:bg-surface-3"
      title={label}
      aria-label={label}
      onClick={onClick}
    >
      <Chevron direction={direction} />
    </button>
  );
}

export function Segmented({
  value,
  onChange,
}: {
  value: "source" | "preview";
  onChange: (value: "source" | "preview") => void;
}) {
  return (
    // A group of two buttons with a pressed state, not a tablist: there is
    // no panel associated with either and no arrow-key navigation between
    // them, and claiming a role whose contract is not honoured tells a
    // screen reader something untrue.
    <div
      role="group"
      aria-label="Show the source or the preview"
      data-testid="view-toggle"
      className="mr-2 flex shrink-0 overflow-hidden rounded-[3px] border border-line"
    >
      {(["source", "preview"] as const).map((option) => (
        <button
          key={option}
          aria-pressed={value === option}
          className={`t-micro border-b-2 px-2 py-[3px] transition-colors duration-[90ms] ${
            value === option
              ? "border-hint bg-surface text-ink"
              : "border-transparent text-ink-3 hover:text-hint"
          }`}
          onClick={() => onChange(option)}
        >
          {option === "source" ? "Source" : "Preview"}
        </button>
      ))}
    </div>
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
