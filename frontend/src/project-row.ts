import { ago } from "./when";

/** What a row of the project list says beyond the name.  Pure, so the
 *  words are tested without a browser and the row only lays them out. */

/** The path as a person writes it: the home directory folded to `~`.
 *
 *  Every project a writer has tends to live under the same few folders, so
 *  twelve rows each began with the same forty characters of prefix and the
 *  part that differed was the part the truncation cut.  The full path is
 *  still on the row, as its title. */
export function shortPath(path: string, home: string): string {
  const root = home.replace(/\/+$/, "");
  if (!root || !path) return path;
  if (path === root) return "~";
  if (path.startsWith(root + "/")) return "~" + path.slice(root.length);
  return path;
}

/** When the project was last opened, in the row's words.  The registry
 *  records 0 for one that was added and never opened. */
export function openedWords(lastOpened: number, now: number = Date.now()): string {
  return ago(lastOpened, now) || "not opened yet";
}

/** The small marks after the name.  Nothing for the ordinary case: a mark
 *  on every row is a mark on none.
 *
 *  `open` is whether a browser is holding the project's event stream at
 *  the moment the list was fetched: another window, or this one before
 *  it came back here, which the server stops counting the moment the
 *  window leaves.  It comes first because it is the mark that changes
 *  what pressing the row does to somebody else. */
export function rowMarks(project: {
  shared: boolean;
  removed: boolean;
  open?: boolean;
}): string[] {
  const marks: string[] = [];
  if (project.open) marks.push("open in another window");
  if (project.shared) marks.push(project.removed ? "removed from the share" : "shared");
  return marks;
}

/** Where an arrow key takes the focus in the list: the id of the row to
 *  land on, or null when the key is not one of the four or there is
 *  nowhere to go.  `order` is every row that can take focus, top to
 *  bottom, and `at` the one that has it.  Pure, like the rest of this
 *  file, so the arithmetic is tested without a browser; the list is
 *  short enough that the ends do not wrap, which is the file tree's rule
 *  too. */
export function rowAfterKey(
  order: string[],
  at: string,
  key: string,
): string | null {
  if (!order.length) return null;
  const index = order.indexOf(at);
  switch (key) {
    case "ArrowDown":
      return order[index + 1] ?? null;
    case "ArrowUp":
      return index > 0 ? order[index - 1] : null;
    case "Home":
      return order[0];
    case "End":
      return order[order.length - 1];
    default:
      return null;
  }
}
