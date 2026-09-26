import { useEffect, useRef, useState } from "react";
import { useDismiss } from "../../useDismiss";
import { useOnScreen, type Wanted } from "../../place-menu";
import { toShell } from "../../viewport";

/** What everything on the projects screen does.
 *
 *  A popover rather than a sheet, and much shorter than the in-project
 *  tutorial, because everything it describes is on the screen behind it.
 *  It carries no figures for the same reason: a picture of something the
 *  reader is already looking at is the least informative figure there is. */
export default function ScreenGuide({
  anchor,
  onClose,
}: {
  anchor: React.RefObject<HTMLButtonElement | null>;
  onClose: () => void;
}) {
  const card = useRef<HTMLDivElement | null>(null);
  useDismiss(card, true, onClose, anchor);

  useEffect(() => {
    card.current?.focus();
  }, []);

  // Fixed and placed by `placeMenu`, the file menu's road, rather than
  // absolute under its button: the button stands at the foot of the
  // projects rail now, where "under" is below the window, and inside a
  // column that scrolls.  Right edges aligned when there is room, above
  // the button when there is none below, pushed in from the left on a
  // phone.  Read once, in shell pixels; the card does not follow a resize
  // and nobody resizes a window with a help card open.
  const [wanted] = useState<Wanted>(() => {
    const box = anchor.current?.getBoundingClientRect();
    if (!box) return { left: 120, top: 120 };
    return {
      left: toShell(box.right) - WIDTH,
      top: toShell(box.bottom) + 4,
      flip: toShell(box.top) - 4,
    };
  });
  const placed = useOnScreen(card, wanted) ?? wanted;

  return (
    <div
      ref={card}
      role="dialog"
      aria-labelledby="screen-guide-heading"
      data-testid="screen-guide"
      tabIndex={-1}
      className="nx-arrive nx-card nx-guide fixed z-40 max-h-[calc(100vh-16px)] w-80 overflow-auto outline-none"
      style={{ left: placed.left, top: placed.top }}
    >
      <div
        id="screen-guide-heading"
        className="nx-guide-title"
      >
        This screen
      </div>
      {ROWS.map(([label, line]) => (
        <div key={label} className="nx-guide-row">
          <div className="nx-guide-label">{label}</div>
          <p className="nx-guide-line">{line}</p>
        </div>
      ))}
      <div className="nx-guide-foot">
        <p className="t-micro text-ink-3">
          A project on disk stays an ordinary LaTeX project. Everything
          NextTex adds lives in a <code className="t-code-sm">.nexttex/</code>{" "}
          folder beside your files.
        </p>
      </div>
    </div>
  );
}

/** The card's width, which `wanted` needs before the card is measured. */
const WIDTH = 320;

const ROWS: [string, string][] = [
  [
    "Click a project to open it",
    "Anywhere in the row. It typesets as it opens.",
  ],
  [
    "New project",
    "A name, where to put it, and what to start from: an article, a report, a talk, a letter or a job application. The other ways in, a folder you already have, an invite somebody sent, a zip or an arXiv id or a git URL, are behind Other ways in.",
  ],
  [
    "Find a project",
    "Press / to reach the box; type any part of a name or a path, and Enter opens the first match. Last opened or Name sorts the list; the choice is kept on this browser.",
  ],
  [
    "Point at a row",
    "Share, and More: a zip or the PDF, Archive, and Move to the trash. Share gives you an invite without opening the project. Archive keeps a finished project out of the way; the trash puts one on the way out. The line under the list opens either view, where Restore brings a project back and Delete forgets it.",
  ],
  [
    "The bar",
    "What writes with you, updates, a problem report, this guide, a lock while the install has no password, and Settings. Each says what it is when you rest on it.",
  ],
  [
    "A row that says the folder is gone",
    "It was moved or deleted. Find it points NextTex at where it is now; a shared project can also be rejoined from your collaborators' copies.",
  ],
];
