import { useEffect, useRef, useState } from "react";
import { Chevron } from "../App";
import api from "../api";
import { get, set } from "../store";
import { useDismiss } from "../useDismiss";

/** Which folder of papers to read into the bibliography.
 *
 *  The folder is almost always *outside* the project — a Zotero library, a
 *  Downloads folder — so the project's own folder chooser cannot serve and
 *  the path fence is not involved. What guards this instead is that the
 *  route behind it is read-only, returns folder names and PDF counts and
 *  never file contents, and does not follow symlinks.
 *
 *  It browses the *server's* filesystem, which is the app's existing model
 *  rather than a new one: a project is already a server-side absolute path
 *  typed into a box on the projects screen. Over Tailscale that is not the
 *  machine you are sitting at, which is exactly why the path is shown in
 *  full at the top rather than implied.
 *
 *  Navigating and choosing are different gestures here, unlike the project
 *  folder chooser. Every folder in a project is on screen at once, so there
 *  Enter confirms; this tree is unbounded and mostly unseen, so Enter
 *  descends and the footer button is the only thing that commits. A single
 *  gesture that did both would make every keystroke on the way to the right
 *  folder a live risk of reading the wrong one.
 */

type Listing = {
  path: string;
  parent: string | null;
  home: string;
  folders: { name: string; path: string; pdfs: number }[];
  pdfsHere: number;
  deep: { pdfs: number; unreadable: number; capped: boolean } | null;
};

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
  const [where, setWhere] = useState("");
  const [typed, setTyped] = useState("");
  const [listing, setListing] = useState<Listing | null>(null);
  const [problem, setProblem] = useState("");
  const [busy, setBusy] = useState(false);
  const [haveReader, setHaveReader] = useState(true);
  const card = useRef<HTMLDivElement | null>(null);
  useDismiss(card, true, onClose);

  useEffect(() => {
    const projectId = get().projectId;
    if (projectId) {
      api.library(projectId).then((state) => setHaveReader(state.haveReader));
    }
    let remembered = "";
    try {
      remembered = window.localStorage.getItem(`nexttex.papers.${projectId}`) ?? "";
    } catch {
      /* private browsing */
    }
    void look(remembered);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const look = async (path: string) => {
    try {
      const found = await api.browse(path, true);
      setListing(found);
      setWhere(found.path);
      setTyped(found.path);
      setProblem("");
    } catch (error: any) {
      setProblem(error.message);
    }
  };

  const start = async () => {
    const projectId = get().projectId;
    if (!projectId || busy) return;
    setBusy(true);
    try {
      await api.scanPapers(projectId, where);
      try {
        window.localStorage.setItem(`nexttex.papers.${projectId}`, where);
      } catch {
        /* private browsing: it just will not be remembered */
      }
      onStarted();
    } catch (error: any) {
      set({ error: error.message });
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
      style={{
        left: Math.min(at.x, window.innerWidth - 328),
        top: Math.min(at.y, window.innerHeight - 340),
      }}
    >
      <div id="papers-heading" className="t-ui truncate px-[10px] pt-2 text-ink">
        Add papers to {bibName}
      </div>

      <div className="mt-1 border-t border-line px-[10px] py-1">
        <input
          value={typed}
          spellCheck={false}
          data-testid="papers-path"
          className={`t-code-sm w-full border-b bg-transparent outline-none ${
            problem ? "border-error" : "border-line focus:border-pen"
          }`}
          onChange={(event) => setTyped(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") void look(typed);
            if (event.key === "Escape") onClose();
          }}
        />
        {problem ? <p className="t-meta mt-1 text-error">{problem}</p> : null}
      </div>

      <div className="max-h-[156px] overflow-auto border-t border-line">
        {listing?.parent ? (
          <button
            className="flex h-[26px] w-full items-center gap-2 px-[10px] text-left hover:bg-surface-2"
            onClick={() => void look(listing.parent!)}
          >
            <span className="shrink-0 rotate-180 text-ink-3">
              <Chevron direction="down" />
            </span>
            <span className="t-ui truncate text-ink-2">
              {listing.parent.split("/").pop() || "/"}
            </span>
          </button>
        ) : null}
        {(listing?.folders ?? []).map((folder) => (
          <button
            key={folder.path}
            data-folder={folder.path}
            className="flex h-[26px] w-full items-center gap-2 px-[10px] text-left hover:bg-surface-2"
            onClick={() => void look(folder.path)}
          >
            <span className="t-ui min-w-0 flex-1 truncate text-ink">
              {folder.name}
            </span>
            {folder.pdfs ? (
              <span className="t-micro tnum shrink-0 text-ink-3">
                {folder.pdfs} PDF{folder.pdfs === 1 ? "" : "s"}
              </span>
            ) : null}
          </button>
        ))}
      </div>

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
