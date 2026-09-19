import { useEffect, useState } from "react";
import api, { type Listing } from "../api";
import { readStored, writeStored } from "../appearance";
import { get, set } from "../store";
import { Sheet } from "../ui/Sheet";
import { Button } from "../ui/Button";
import { Heading } from "../ui/controls";
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
  onClose,
  onStarted,
}: {
  bibName: string;
  onClose: () => void;
  onStarted: () => void;
}) {
  const [listing, setListing] = useState<Listing | null>(null);
  const [busy, setBusy] = useState(false);
  const [haveReader, setHaveReader] = useState(true);

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
    <Sheet open onClose={onClose} labelledBy="papers-heading" testid="papers-chooser" width={380}>
      <Heading id="papers-heading" className="truncate pb-[8px]">
        Add papers to {bibName}
      </Heading>

      <FolderBrowser
        starts={starts}
        count
        pathTestId="papers-path"
        onListing={setListing}
        onEscape={onClose}
      />

      <div className="pt-2">
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

      <div className="nx-sheet-foot">
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="ghost" disabled={!total || busy || !haveReader} onClick={start}>
          Read {total} paper{total === 1 ? "" : "s"}
        </Button>
      </div>
    </Sheet>
  );
}
