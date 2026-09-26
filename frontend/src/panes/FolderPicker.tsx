import { useState } from "react";
import { type Listing } from "../api";
import { Sheet } from "../ui/Sheet";
import { Button } from "../ui/Button";
import { Heading } from "../ui/controls";
import { projectFolderFor, startingPoints, type WayIn } from "../project-path";
import FolderBrowser from "./FolderBrowser";

/** Picking a folder for a project, on the machine running NextTex.
 *
 *  The writer asked for it in these words: a Browse button for "where",
 *  so the location is chosen visually rather than typed. A browser's own
 *  folder dialog cannot serve, since what it hands back is files and not
 *  a path on the server's disk, and the disk that matters is the
 *  server's. So this is the papers chooser's walk with a different
 *  footer: what choosing means here depends on the way in.  Pointing at
 *  a folder means that folder, since it already holds the project.
 *  Starting something new or joining needs a folder that does not exist
 *  yet, so the picked one is the parent and the project's own folder
 *  goes under it, named from the title where there is one and left for
 *  the writer to finish where there is not; `projectFolderFor` in
 *  `project-path.ts` is the arithmetic.
 */
export default function FolderPicker({
  mode,
  name,
  typed,
  onPick,
  onClose,
}: {
  mode: WayIn;
  /** The title typed for a new project, for its folder's name. */
  name: string;
  /** What the path field says, which is where the walk starts when it
   *  names a folder, or its parent when it names one not yet made. */
  typed: string;
  onPick: (path: string) => void;
  onClose: () => void;
}) {
  const [listing, setListing] = useState<Listing | null>(null);
  const [starts] = useState(() => startingPoints(typed));

  const heading =
    mode === "add"
      ? "Which folder holds it?"
      : mode === "create"
      ? "Which folder should it go in?"
      : "Which folder should it arrive in?";
  const commit = mode === "add" ? "Use this folder" : "Put it in here";

  return (
    <Sheet
      open
      onClose={onClose}
      labelledBy="folder-picker-heading"
      testid="folder-picker"
      width={380}
      // Escape belongs to this card while it is open.  On a phone it
      // stands inside the ways-in drawer, itself a dialog listening on
      // the window; stopped here, one press closes the picker and leaves
      // the drawer, rather than both at once.
      onKeyDown={(event) => {
        if (event.key !== "Escape") return;
        event.stopPropagation();
        onClose();
      }}
    >
      <Heading id="folder-picker-heading" className="truncate pb-2">
        {heading}
      </Heading>

      <FolderBrowser
        starts={starts}
        pdfs={false}
        pathTestId="picker-path"
        onListing={setListing}
        onEscape={onClose}
      />

      <div className="pt-2">
        <p className="t-micro text-ink-3">
          {mode === "add"
            ? "The folder that already has the LaTeX document in it."
            : mode === "create"
            ? "A new folder is made inside the one you choose, named after the project."
            : "A new folder is made inside the one you choose; you name it."}{" "}
          The folder is on the machine running NextTex.
        </p>
      </div>

      <div className="nx-sheet-foot">
        <Button onClick={onClose}>Cancel</Button>
        <Button
          variant="ghost"
          data-testid="pick-folder"
          disabled={!listing}
          onClick={() => listing && onPick(projectFolderFor(listing.path, name, mode))}
        >
          {commit}
        </Button>
      </div>
    </Sheet>
  );
}
