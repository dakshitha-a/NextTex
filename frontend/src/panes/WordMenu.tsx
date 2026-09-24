import { Menu, MenuDivider, MenuHeader, MenuItem } from "../ui/Menu";

/** What the menu on an underlined word offers: a misspelling, or a
 *  grammar finding with Harper's sentence. */
export type WordOffer = {
  kind: "spelling" | "grammar";
  message?: string;
  word: string;
  x: number;
  y: number;
  flip: number;
  guesses: string[];
};

/** The menu on an underlined word, a chunk of its own: it exists only
 *  once a word has been right-clicked, so the entry bundle does not carry
 *  it. The kit's menu, placed on the screen from its measured size, put
 *  away by a press anywhere else, and closed by Escape. */
export default function WordMenu({
  offer,
  onClose,
  onReplace,
  onIgnoreForNow,
  onIgnoreInProject,
  onAdd,
}: {
  offer: WordOffer;
  onClose: () => void;
  onReplace: (guess: string) => void;
  onIgnoreForNow: () => void;
  onIgnoreInProject: () => void;
  onAdd: () => void;
}) {
  return (
    <Menu
      open
      onClose={onClose}
      wanted={{ left: offer.x, top: offer.y, flip: offer.flip }}
      testid="spelling-menu"
      width={offer.kind === "grammar" ? 280 : 232}
      // A digit picks the guess with that number, which the hint beside
      // each guess promises.
      onKey={(event) => {
        const digit = Number(event.key);
        if (!Number.isInteger(digit) || digit < 1 || digit > offer.guesses.length) return false;
        event.preventDefault();
        onReplace(offer.guesses[digit - 1]);
        return true;
      }}
    >
      {/* A grammar finding opens with what is wrong, in Harper's words,
          above the replacements: a misspelling needs no sentence. */}
      {offer.kind === "grammar" && offer.message ? <MenuHeader>{offer.message}</MenuHeader> : null}
      {/* The guesses first, because a typo is the common case and adding
          a typo to the dictionary is the one outcome nobody wants; each
          with its number, so the first is a keystroke away.  A word that
          is nothing like anything in the list gets no guesses at all. */}
      {offer.guesses.map((guess, index) => (
        <MenuItem key={guess} hint={index < 9 ? String(index + 1) : undefined} onClick={() => onReplace(guess)}>
          {guess}
        </MenuItem>
      ))}
      {offer.guesses.length ? <MenuDivider /> : null}
      {/* For this sitting only: gone on a reload, and nothing is kept. */}
      <MenuItem data-testid="ignore-for-now" onClick={onIgnoreForNow}>
        Ignore for now
      </MenuItem>
      {offer.kind === "grammar" ? (
        <MenuItem data-testid="ignore-in-project" onClick={onIgnoreInProject}>
          Ignore in this project
        </MenuItem>
      ) : (
        <MenuItem onClick={onAdd}>Add “{offer.word}” to the dictionary</MenuItem>
      )}
    </Menu>
  );
}
