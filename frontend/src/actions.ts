/** Every action the app answers from anywhere, in one list.
 *
 *  The chords were literal `if` blocks in two keydown effects in `App`,
 *  the Tutorial's Keyboard section was a second list typed by hand, and
 *  the README's table a third; the three drifted, and the README said the
 *  settings sheet held the list when it was the Tutorial.  This is the one
 *  list.  `App` builds a handler per id and its keydown effect walks this
 *  table with `matchesChord`; the Tutorial renders the rows that carry a
 *  chord; `actions.test.ts` reads the README's table and asserts the two
 *  agree; and the command palette lists everything here, chord or not.
 *
 *  No handlers in this file, so vitest can walk it without React.  A spec
 *  is written the way `keys.ts` reads one: `Mod-Alt-Shift-T`, `F8`.  The
 *  letter of a chord with Alt held is matched on `event.code`, because
 *  with Alt held macOS reports the character the combination would type,
 *  `å` for `Alt-A`, in `event.key`.
 */

export type Group = "Build" | "Navigate" | "Editor" | "Agent" | "View" | "Project" | "Settings";

export type Action = {
  id: string;
  /** What the palette shows and the Tutorial's row says. */
  label: string;
  group: Group;
  chord?: string;
  /** The Tutorial's wording where it differs from the palette's label. */
  does?: string;
  /** Where the README's table lists the chord: it answers from anywhere,
   *  but a chord that acts on the caret reads better beside the source's
   *  own keys. */
  where?: "source";
};

export const ACTIONS: readonly Action[] = [
  { id: "save", label: "Save now, or build when compile as you type is off", group: "Build", chord: "Mod-S",
    does: "Save this instant; compile instead when Compile as you type is off" },
  { id: "build", label: "Build the document", group: "Build" },
  { id: "build-full", label: "Build with the bibliography", group: "Build" },
  { id: "reveal", label: "Scroll the page to this line, or run the script", group: "Navigate", chord: "Mod-Enter",
    does: "Scroll the page to the line you are on; in a script, run it", where: "source" },
  { id: "rail", label: "Hide or show the left column", group: "View", chord: "Mod-B", does: "Hide the left column" },
  { id: "agent", label: "Show or hide the agent", group: "Agent", chord: "Mod-Alt-A", does: "Show or hide the agent, ready to type" },
  { id: "next-preview", label: "Move between the previewed documents", group: "Navigate", chord: "Mod-Alt-P" },
  { id: "search", label: "Find and replace across every file", group: "Navigate", chord: "Mod-Shift-F" },
  { id: "quick-open", label: "Open a file by typing its name", group: "Navigate", chord: "Mod-Alt-O" },
  { id: "next-tab", label: "Next tab", group: "Navigate", chord: "Mod-Alt-]" },
  { id: "previous-tab", label: "Previous tab", group: "Navigate", chord: "Mod-Alt-[" },
  { id: "close-tab", label: "Close the tab in front", group: "Navigate", chord: "Mod-Alt-W" },
  { id: "reopen-tab", label: "Reopen the tab you just closed", group: "Navigate", chord: "Mod-Alt-Shift-T" },
  { id: "reading", label: "Reading mode, or the layout back", group: "View", chord: "Mod-Alt-R", does: "Reading mode; again puts your layout back" },
  { id: "writing", label: "Writing mode, or the layout back", group: "View", chord: "Mod-Alt-E", does: "Writing mode; again puts it back" },
  { id: "next-error", label: "Next error", group: "Navigate", chord: "F8" },
  { id: "previous-error", label: "Previous error", group: "Navigate", chord: "Shift-F8" },
  { id: "palette", label: "Every action, setting and file, by typing", group: "View", chord: "Mod-K",
    does: "This list, every setting and every file, found by typing" },
  { id: "settings", label: "Open the settings sheet", group: "Settings" },
  { id: "tutorial", label: "Open the tutorial", group: "View" },
  { id: "history", label: "Show or hide the version history", group: "View" },
  { id: "share", label: "Share this project", group: "Project" },
  { id: "download-zip", label: "Download the whole project as a zip", group: "Project" },
  { id: "download-pdf", label: "Download the PDF", group: "Project" },
  { id: "projects", label: "Back to the projects", group: "Project" },
];

/** The chords, for the Tutorial's Anywhere group: the actions that have
 *  one and are not listed with the source's own keys. */
export const CHORDED: readonly Action[] = ACTIONS.filter((action) => action.chord && !action.where);

const CODE_FOR: Record<string, string> = {
  "[": "BracketLeft", "]": "BracketRight", ".": "Period", ",": "Comma",
  "/": "Slash", "\\": "Backslash", "'": "Quote", ";": "Semicolon",
  "-": "Minus", "=": "Equal", "`": "Backquote",
};

/** The shape of a keydown this reads, so a test can hand in a literal. */
export type KeyLike = {
  key: string;
  code: string;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  /** Present on a real event; a literal in a test may leave it out. */
  getModifierState?: (key: string) => boolean;
};

/** Whether this keydown is the chord.  `Mod` is Meta or Ctrl, as every
 *  handler in the app reads it; the letter is compared on `code` so Alt
 *  on a Mac cannot hide it, and a chord that names no Shift refuses a
 *  press with Shift held, so `Mod-Alt-T` and `Mod-Alt-Shift-T` are two. */
export function matchesChord(event: KeyLike, spec: string): boolean {
  const parts = spec.split("-").filter(Boolean);
  const key = parts[parts.length - 1];
  const wantMod = parts.includes("Mod");
  const wantAlt = parts.includes("Alt");
  const wantShift = parts.includes("Shift");
  // AltGr is how German, French, Nordic and Polish layouts type @, €, [,
  // ] and letters such as ą, ę and ó, and on Windows it reaches the
  // browser as Ctrl and Alt held together, so the Polish ą was the chord
  // that shows the Claude column (Q-030). A press with AltGraph held is
  // never a chord.
  if (event.getModifierState?.("AltGraph")) return false;
  if ((event.metaKey || event.ctrlKey) !== wantMod) return false;
  if (event.altKey !== wantAlt) return false;
  if (event.shiftKey !== wantShift) return false;
  if (/^F\d+$/.test(key) || key === "Enter" || key === "Escape" || key.startsWith("Arrow")) {
    return event.key === key;
  }
  if (key.length === 1 && /[A-Za-z]/.test(key)) {
    // Ctrl and Alt without Meta, and the key made a character that is not
    // this letter: that is AltGr typing, whether or not the browser says
    // AltGraph. On a Mac the app's chords hold Cmd, so Option's own
    // characters there are left to the chord.
    if (event.ctrlKey && event.altKey && !event.metaKey
        && event.key.length === 1 && event.key.toLowerCase() !== key.toLowerCase()) {
      return false;
    }
    return event.code === `Key${key.toUpperCase()}`;
  }
  if (key.length === 1 && /[0-9]/.test(key)) {
    return event.code === `Digit${key}`;
  }
  const code = CODE_FOR[key];
  return code ? event.code === code : event.key === key;
}

/** The action a keydown asks for, or null. */
export function actionFor(event: KeyLike): Action | null {
  for (const action of ACTIONS) {
    if (action.chord && matchesChord(event, action.chord)) return action;
  }
  return null;
}
