import { useRef, useState } from "react";
import { useOnScreen, type Wanted } from "../place-menu";
import { toShell } from "../viewport";
import { type Listing } from "../api";
import { useDismiss } from "../useDismiss";
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
  anchor,
  onPick,
  onClose,
}: {
  mode: WayIn;
  /** The title typed for a new project, for its folder's name. */
  name: string;
  /** What the path field says, which is where the walk starts when it
   *  names a folder, or its parent when it names one not yet made. */
  typed: string;
  anchor: React.RefObject<HTMLButtonElement | null>;
  onPick: (path: string) => void;
  onClose: () => void;
}) {
  const card = useRef<HTMLDivElement | null>(null);
  useDismiss(card, true, onClose, anchor);
  const [listing, setListing] = useState<Listing | null>(null);
  const [starts] = useState(() => startingPoints(typed));
  // Under the Browse button when there is room, above it when there is
  // not, and inside the screen either way: the button stands in a rail
  // whose foot is near the bottom of the window.
  const [wanted] = useState<Wanted>(() => {
    const box = anchor.current?.getBoundingClientRect();
    if (!box) return { left: 120, top: 120 };
    return { left: toShell(box.left), top: toShell(box.bottom) + 4, flip: toShell(box.top) - 4 };
  });
  // Measured again when the listing lands: the card is a heading and a
  // footer until then, and a placement made at that height put the
  // folders below the bottom of a phone once they arrived.
  const placed = useOnScreen(card, wanted, listing) ?? wanted;

  const heading =
    mode === "add"
      ? "Which folder holds it?"
      : mode === "create"
      ? "Which folder should it go in?"
      : "Which folder should it arrive in?";
  const commit = mode === "add" ? "Use this folder" : "Put it in here";

  return (
    <div
      ref={card}
      role="dialog"
      aria-labelledby="folder-picker-heading"
      data-testid="folder-picker"
      className="nx-arrive fixed z-40 w-[320px] rounded-[5px] border border-line bg-surface shadow-float"
      style={{ left: placed.left, top: placed.top }}
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
      <div id="folder-picker-heading" className="t-ui truncate px-[10px] pt-2 text-ink">
        {heading}
      </div>

      <FolderBrowser
        starts={starts}
        pdfs={false}
        pathTestId="picker-path"
        onListing={setListing}
        onEscape={onClose}
      />

      <div className="border-t border-line px-[10px] py-2">
        <p className="t-micro text-ink-3">
          {mode === "add"
            ? "The folder that already has the LaTeX document in it."
            : mode === "create"
            ? "A new folder is made inside the one you choose, named after the project."
            : "A new folder is made inside the one you choose; you name it."}{" "}
          The folder is on the machine running NextTex.
        </p>
      </div>

      <div className="flex h-[32px] items-center justify-end gap-2 border-t border-line px-[10px]">
        <button
          className="ghost-button h-[28px] px-3 t-ui"
          data-testid="pick-folder"
          disabled={!listing}
          onClick={() => listing && onPick(projectFolderFor(listing.path, name, mode))}
        >
          {commit}
        </button>
        <button className="quiet h-[28px] px-2 t-ui" onClick={onClose}>
          Cancel
        </button>
      </div>
    </div>
  );
}
