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
 *  on every row is a mark on none. */
export function rowMarks(project: {
  shared: boolean;
  removed: boolean;
}): string[] {
  if (!project.shared) return [];
  return [project.removed ? "removed from the share" : "shared"];
}
