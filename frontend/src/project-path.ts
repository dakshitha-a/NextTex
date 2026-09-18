/** Where a project goes once a folder has been picked for it.
 *
 *  The Browse button on the projects screen picks a folder on the
 *  machine's disk, and what the path field should then say depends on
 *  which way in is chosen.  Pointing at a folder means that folder: it
 *  already holds the project.  Starting something new or joining means a
 *  folder that does not exist yet, so the picked one is the parent and
 *  the project's own folder goes under it: named from the title for a
 *  new project, and left for the writer to finish, with the caret at the
 *  end, when there is no title yet or the project is somebody else's.
 *  Pure, like the rest of the screen's arithmetic, so the cases are a
 *  vitest rather than a browser. */

export type WayIn = "create" | "add" | "join";

/** A title as a folder name: lower case, every run of anything that is
 *  not a letter or a digit collapsed to one hyphen, none at the ends.
 *  Letters in any script count, so a title in Greek or Tamil is a folder
 *  rather than a hyphen. */
export function slug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "");
}

export function projectFolderFor(folder: string, name: string, mode: WayIn): string {
  if (mode === "add") return folder;
  const base = folder.endsWith("/") ? folder : `${folder}/`;
  return mode === "create" ? base + slug(name) : base;
}

/** The folder a typed path names, or its parent when the path does not
 *  exist yet, for a picker to open on.  What is typed for a new project
 *  is the folder that will be made, so its parent is the one to show;
 *  the candidates are tried in order by whoever can ask the disk. */
export function startingPoints(typed: string): string[] {
  const path = typed.trim().replace(/\/+$/, "");
  if (!path) return [""];
  const cut = path.lastIndexOf("/");
  const parent = cut > 0 ? path.slice(0, cut) : cut === 0 ? "/" : "";
  return parent && parent !== path ? [path, parent, ""] : [path, ""];
}
