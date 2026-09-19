import { useEffect, useState } from "react";
import { Field } from "../ui/controls";
import { ChevronUpIcon, FolderIcon } from "../ui/icons";
import api, { type Listing } from "../api";

/** Walking the folders of the machine running NextTex.
 *
 *  The path box, the row that goes up, and the folders under the one
 *  being looked at: the part of the papers chooser that was about folders
 *  rather than about papers, taken out so the projects screen's Browse
 *  button could have the same walk without a second copy of it. Whoever
 *  draws this decides what choosing means and draws the footer that
 *  commits: here, Enter in the box looks and a row descends, and nothing
 *  is ever chosen, because a tree that is mostly unseen is one where
 *  every keystroke on the way to the right folder should be safe.
 *
 *  It browses the *server's* filesystem, which is the app's existing
 *  model rather than a new one: a project is already a server-side
 *  absolute path typed into a box on the projects screen. Over Tailscale
 *  that is not the machine you are sitting at, which is exactly why the
 *  path is shown in full at the top rather than implied.
 */
export default function FolderBrowser({
  starts,
  count = false,
  pdfs = true,
  pathTestId,
  onListing,
  onEscape,
}: {
  /** Where to open, tried in order until one is a folder: a remembered or
   *  typed path first, its parent when that does not exist yet, and ""
   *  for home last.  Only the last failure is shown; the earlier ones
   *  are expected. */
  starts: string[];
  /** Whether to walk the whole tree for a total, which the papers chooser
   *  wants and the project picker does not. */
  count?: boolean;
  /** Whether each folder's PDFs are counted, likewise. */
  pdfs?: boolean;
  pathTestId: string;
  onListing: (listing: Listing) => void;
  onEscape: () => void;
}) {
  const [typed, setTyped] = useState("");
  const [listing, setListing] = useState<Listing | null>(null);
  const [problem, setProblem] = useState("");

  const look = async (path: string): Promise<boolean> => {
    try {
      const found = await api.browse(path, count, pdfs);
      setListing(found);
      setTyped(found.path);
      setProblem("");
      onListing(found);
      return true;
    } catch (error: any) {
      setProblem(error.message);
      return false;
    }
  };

  useEffect(() => {
    let stopped = false;
    (async () => {
      for (const start of starts) {
        if (stopped) return;
        if (await look(start)) return;
      }
    })();
    return () => {
      stopped = true;
    };
    // Once, on the way in: `starts` is what the opener knew then.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <>
      <div className="pt-1">
        <Field
          value={typed}
          spellCheck={false}
          aria-label="A folder on the machine running NextTex"
          data-testid={pathTestId}
          frameClassName={`w-full${problem ? " ring-1 ring-error" : ""}`}
          className="font-mono text-[12.5px]"
          onChange={(event) => setTyped(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") void look(typed);
            if (event.key === "Escape") onEscape();
          }}
        />
        {problem ? <p className="t-meta mt-1 text-error">{problem}</p> : null}
      </div>

      <div className="nx-sheet-list">
        {listing?.parent ? (
          <button
            className="nx-row"
            data-testid="folder-up"
            onClick={() => void look(listing.parent!)}
          >
            <ChevronUpIcon size={14} />
            <span className="nx-row-label">
              {listing.parent.split("/").pop() || "/"}
            </span>
          </button>
        ) : null}
        {(listing?.folders ?? []).map((folder) => (
          <button
            key={folder.path}
            data-folder={folder.path}
            className="nx-row"
            onClick={() => void look(folder.path)}
          >
            <FolderIcon />
            <span className="nx-row-label text-ink">{folder.name}</span>
            {folder.pdfs ? (
              <span className="nx-row-trailing nx-row-trailing-always tnum">
                {folder.pdfs} PDF{folder.pdfs === 1 ? "" : "s"}
              </span>
            ) : null}
          </button>
        ))}
        {listing && !listing.folders.length ? (
          <p className="t-meta px-[8px] py-1 text-ink-3">No folders in here.</p>
        ) : null}
      </div>
    </>
  );
}
