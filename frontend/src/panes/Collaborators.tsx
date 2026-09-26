import { type Collaborator, useStore } from "../store";
import { awayWords, peerStanding } from "./peer-standing";
import { Pressable } from "../ui/controls";

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
 *  A click on the faces opens the People drawer, which is where the rows
 *  with names, files and Remove live; the popover that used to open here
 *  went with it (item 2.1 of the frame run).
 */
export default function Collaborators({ onOpen }: {
  /** Open the People drawer. */
  onOpen?: () => void;
}) {
  const people = useStore((s) => s.collaborators);
  const connection = useStore((s) => s.connection);
  const share = useStore((s) => s.share);
  const standing = peerStanding(share);

  if (!people.length && connection !== "offline" && standing !== "away") {
    return null;
  }

  return (
    <div className="relative flex shrink-0 items-center gap-1.5 pr-2 pl-1.5">
      {connection === "offline" ? (
        <span
          className="t-micro flex items-center gap-1.25 text-warn"
          data-testid="sync-offline"
        >
          <span className="font-medium">offline</span>
          <span className="text-ink-3">
            what you type is kept here until it reconnects
          </span>
        </span>
      ) : null}

      {standing === "away" ? (
        <span className="t-micro text-ink-3" data-testid="peer-away">
          {awayWords(share)}
        </span>
      ) : null}

      {people.length ? (
        <Pressable
          className="flex items-center gap-0.75"
          aria-label={`${people.length} other ${
            people.length === 1 ? "person" : "people"
          } in this project`}
          title="Who is in this project"
          data-testid="collaborators"
          onClick={onOpen}
        >
          {people.slice(0, 4).map((person) => (
            <Initial key={person.clientId} person={person} />
          ))}
          {people.length > 4 ? (
            <span className="t-micro text-ink-3">+{people.length - 4}</span>
          ) : null}
        </Pressable>
      ) : null}
    </div>
  );
}

function Initial({ person }: { person: Collaborator }) {
  const where = person.path ? ` in ${person.path}` : "";
  return (
    <span
      title={`${person.name}${where}${person.active ? ", writing" : ""}`}
      className="grid h-4.5 w-4.5 place-items-center rounded-full text-badge leading-none font-medium"
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
