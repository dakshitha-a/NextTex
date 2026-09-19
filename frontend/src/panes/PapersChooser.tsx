import { useEffect, useMemo, useRef, useState } from "react";
import { useOnScreen } from "../place-menu";
import api, { type Listing } from "../api";
import { readStored, writeStored } from "../appearance";
import { get, set } from "../store";
import { useDismiss } from "../useDismiss";
import FolderBrowser from "./FolderBrowser";

/** Which folder of papers to read into the bibliography.
 *
 *  The folder is almost always *outside* the project, a Zotero library or a
 *  Downloads folder, so the project's own folder chooser cannot serve and
 *  the path fence is not involved. What guards this instead is that the
 *  route behind it is read-only, returns folder names and PDF counts and
 *  never file contents, and does not follow symlinks.
 *
 *  The walk itself, the path box and the folders under it, is
 *  `FolderBrowser`, shared with the projects screen's Browse button since
 *  the projects rail run. What is this chooser's own is what the walk is
 *  for: the PDF counts on the way, the total under the list, and the one
 *  button that commits to reading them.
 *
 *  Navigating and choosing are different gestures here, unlike the project
 *  folder chooser. Every folder in a project is on screen at once, so there
 *  Enter confirms; this tree is unbounded and mostly unseen, so Enter
 *  descends and the footer button is the only thing that commits. A single
 *  gesture that did both would make every keystroke on the way to the right
 *  folder a live risk of reading the wrong one.
 */
export default function PapersChooser({
  bibName,
  at,
  onClose,
  onStarted,
}: {
  bibName: string;
  at: { x: number; y: number };
  onClose: () => void;
  onStarted: () => void;
}) {
  const [listing, setListing] = useState<Listing | null>(null);
  const [busy, setBusy] = useState(false);
  const [haveReader, setHaveReader] = useState(true);
  const card = useRef<HTMLDivElement | null>(null);
  useDismiss(card, true, onClose);
  // Kept on the screen by measurement rather than by a guess at its
  // height, the file menu's road; it used to be `min(at, viewport - 340)`.
  const wanted = useMemo(() => ({ left: at.x, top: at.y }), [at.x, at.y]);
  const placed = useOnScreen(card, wanted, listing) ?? wanted;

  const projectId = get().projectId;
  useEffect(() => {
    if (projectId) {
      api.library(projectId).then((state) => setHaveReader(state.haveReader));
    }
  }, [projectId]);
  // Where it was last read from, then home.
  const [starts] = useState<string[]>(() => {
    const remembered = readStored(`nexttex.papers.${projectId}`);
    return remembered ? [remembered, ""] : [""];
  });

  const where = listing?.path ?? "";

  const start = async () => {
    if (!projectId || busy || !where) return;
    setBusy(true);
    try {
      await api.scanPapers(projectId, where);
      writeStored(`nexttex.papers.${projectId}`, where);
      onStarted();
    } catch (error: any) {
      set({ error: error.message });
    } finally {
      // In a `finally`, because it was only lowered on the failure path.
      // A scan that started and whose panel then closed left this raised,
      // and `start` returns early while it is, so the button did nothing
      // for the rest of the session with no way to find out why.
      setBusy(false);
    }
  };

  const total = listing?.deep?.pdfs ?? 0;

  return (
    <div
      ref={card}
      role="dialog"
      aria-labelledby="papers-heading"
      data-testid="papers-chooser"
      className="nx-arrive fixed z-40 w-[320px] rounded-[5px] border border-line bg-surface shadow-float"
      style={{ left: placed.left, top: placed.top }}
    >
      <div id="papers-heading" className="t-ui truncate px-[10px] pt-2 text-ink">
        Add papers to {bibName}
      </div>

      <FolderBrowser
        starts={starts}
        count
        pathTestId="papers-path"
        onListing={setListing}
        onEscape={onClose}
      />

      <div className="border-t border-line px-[10px] py-2">
        {!haveReader ? (
          <p className="t-meta text-warn">
            NextTex needs pdftotext to read a PDF. It comes with poppler-utils.
          </p>
        ) : (
          <>
            <p className="t-meta text-ink-2" data-testid="papers-count">
              {total
                ? `${total} PDF${total === 1 ? "" : "s"} here and in everything under it.`
                : "No PDFs here."}
              {listing?.deep?.unreadable
                ? ` ${listing.deep.unreadable} folder${
                    listing.deep.unreadable === 1 ? "" : "s"
                  } could not be read.`
                : ""}
            </p>
            <p className="t-micro mt-1 text-ink-3">
              The folder has to be on the machine running NextTex.
            </p>
          </>
        )}
      </div>

      <div className="flex h-[32px] items-center justify-end gap-2 border-t border-line px-[10px]">
        <button
          className="ghost-button h-[28px] px-3 t-ui"
          disabled={!total || busy || !haveReader}
          onClick={start}
        >
          Read {total} paper{total === 1 ? "" : "s"}
        </button>
        <button className="quiet h-[28px] px-2 t-ui" onClick={onClose}>
          Cancel
        </button>
      </div>
    </div>
  );
}
