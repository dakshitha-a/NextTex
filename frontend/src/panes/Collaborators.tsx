import { useState } from "react";
import { type Collaborator, useStore } from "../store";
import { useDismiss } from "../useDismiss";
import { useRef } from "react";

/** Who else is in this project, and whether they are working.
 *
 *  Sits in the tab strip's right-hand end, beside the document being
 *  written rather than in a panel of its own.  Presence is peripheral
 *  information -- you want to know somebody is in chapter four without
 *  going to look -- and a panel you have to open is a panel nobody opens.
 *
 *  Three states, and the distinction between the last two is the whole
 *  point of the thing:
 *
 *  - **Nobody else.** Draws nothing at all. An empty strip labelled
 *    "collaborators" on a project with no collaborators is a permanent
 *    reminder of a feature you are not using.
 *  - **Here.** Connected, cursor somewhere, not typing. A quiet initial.
 *  - **Working.** Typed within the last minute. The ring fills.
 *
 *  Names are shown on hover rather than always, because four people in a
 *  paper is four names competing with the file tabs for the same strip.
 */
export default function Collaborators() {
  const people = useStore((s) => s.collaborators);
  const connection = useStore((s) => s.connection);
  const [open, setOpen] = useState(false);
  const card = useRef<HTMLDivElement | null>(null);
  const trigger = useRef<HTMLButtonElement | null>(null);
  useDismiss(card, open, () => setOpen(false), trigger);

  // Offline is worth saying even with nobody else here: it means this
  // browser's typing is not reaching the file, which is the one thing a
  // writer must never find out later.
  if (!people.length && connection !== "offline") return null;

  return (
    <div className="relative flex shrink-0 items-center gap-[6px] pr-[8px] pl-[6px]">
      {connection === "offline" ? (
        <span
          className="t-micro text-warn"
          title="Not connected. What you type is kept here until it is."
          data-testid="sync-offline"
        >
          offline
        </span>
      ) : null}

      {people.length ? (
        <button
          ref={trigger}
          className="flex items-center gap-[3px]"
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-label={`${people.length} other ${
            people.length === 1 ? "person" : "people"
          } in this project`}
          data-testid="collaborators"
          onClick={() => setOpen((value) => !value)}
        >
          {people.slice(0, 4).map((person) => (
            <Initial key={person.clientId} person={person} />
          ))}
          {people.length > 4 ? (
            <span className="t-micro text-ink-3">+{people.length - 4}</span>
          ) : null}
        </button>
      ) : null}

      {open ? (
        <div
          ref={card}
          role="dialog"
          aria-label="Who is here"
          className="nx-arrive absolute top-[28px] right-0 z-40 w-[230px] rounded-[5px] border border-line bg-surface py-[4px] shadow-float"
        >
          {/* Counting you as well. A list that omits the reader reads as
              one person when there are two. */}
          <div className="t-micro border-b border-line px-[10px] pb-[4px] text-ink-3">
            {people.length + 1} people in this project
          </div>
          {people.map((person) => (
            <div
              key={person.clientId}
              className="flex items-baseline gap-[7px] px-[10px] py-[3px]"
            >
              <span
                aria-hidden="true"
                className="h-[7px] w-[7px] shrink-0 translate-y-[-1px] rounded-full"
                style={{
                  background: person.active ? person.colour : "transparent",
                  border: `1px solid ${person.colour}`,
                }}
              />
              <span className="t-meta min-w-0 flex-1 truncate text-ink">
                {person.name}
              </span>
              <span className="t-micro shrink-0 truncate text-ink-3" title={person.path}>
                {person.path ? shortPath(person.path) : "not in a file"}
                {person.active ? "" : " · idle"}
              </span>
            </div>
          ))}
          <div className="t-micro flex items-baseline gap-[7px] px-[10px] py-[3px] text-ink-3">
            <span
              aria-hidden="true"
              className="h-[7px] w-[7px] shrink-0 translate-y-[-1px] rounded-full border border-ink-3"
            />
            <span className="flex-1">you</span>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function Initial({ person }: { person: Collaborator }) {
  const where = person.path ? ` in ${person.path}` : "";
  return (
    <span
      title={`${person.name}${where}${person.active ? ", writing" : ""}`}
      className="grid h-[18px] w-[18px] place-items-center rounded-full text-[10px] leading-none font-medium"
      style={{
        // Filled while they are typing, outlined while they are only here.
        // Two states in one mark, so the strip says who is *working* rather
        // than only who left a tab open.
        background: person.active ? person.colour : "transparent",
        border: `1px solid ${person.colour}`,
        // A fixed dark ink rather than `--surround`, which is a light grey
        // in the light theme and would be pale-on-pale: every peer colour
        // is chosen light enough to carry this one, and none of them is
        // light enough to carry the light theme's surround.
        color: person.active ? "#141715" : person.colour,
      }}
    >
      {(person.name.trim()[0] || "?").toUpperCase()}
    </span>
  );
}

/** `chapters/02_theory.tex` as `02_theory.tex`. The folder is rarely the
 *  interesting half, and the strip is narrow. */
function shortPath(path: string): string {
  const cut = path.lastIndexOf("/");
  return cut === -1 ? path : path.slice(cut + 1);
}
