import { useEffect, useRef } from "react";
import { useDismiss } from "../../useDismiss";

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

  return (
    <div
      ref={card}
      role="dialog"
      aria-labelledby="screen-guide-heading"
      data-testid="screen-guide"
      tabIndex={-1}
      className="nx-arrive absolute right-0 top-[30px] z-40 max-h-[calc(100vh-80px)] w-[320px] overflow-auto rounded-[5px] border border-line bg-surface shadow-float outline-none"
    >
      <div
        id="screen-guide-heading"
        className="t-ui px-[10px] pb-1 pt-2 text-ink"
      >
        About this screen
      </div>
      {ROWS.map(([label, line]) => (
        <div key={label} className="border-t border-line px-[10px] py-2">
          <div className="t-meta text-ink">{label}</div>
          <p className="t-micro mt-[2px] text-ink-2">{line}</p>
        </div>
      ))}
      <div className="border-t border-line px-[10px] py-2">
        <p className="t-micro text-ink-3">
          A project on disk stays an ordinary LaTeX project. Everything
          NextTex adds lives in a <code className="t-code-sm">.nexttex/</code>{" "}
          folder beside your files.
        </p>
      </div>
    </div>
  );
}

const ROWS: [string, string][] = [
  [
    "Click a project to open it",
    "Anywhere in the row, not a button at the end of it. It typesets as it opens.",
  ],
  [
    "Start something new",
    "Makes the folder and one empty document. Give the agent your template afterwards and it will shape the project around it.",
  ],
  [
    "Point at a folder",
    "For a LaTeX project you already have. Nothing is copied and nothing is moved.",
  ],
  [
    "The path is on the machine running NextTex",
    "Which, if you reached this page over Tailscale, is not the laptop you are sitting at. A leading ~ works.",
  ],
  [
    "Zip and PDF",
    "Zip is the project as it stands. PDF typesets first, so it takes a moment, and says why if the document does not build.",
  ],
  [
    "Remove",
    "Takes the project out of NextTex. The files stay exactly where they are.",
  ],
  [
    "A row that says the folder is gone",
    "It was moved or deleted. Remove the row, then point at the new location.",
  ],
  [
    "The cog",
    "Theme, interface size and editor text size. They follow you between projects; the per-project switches appear once one is open.",
  ],
];
