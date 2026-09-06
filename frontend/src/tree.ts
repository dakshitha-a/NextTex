import type { TreeNode } from "./api";

/** Reading the file tree the store already holds.
 *
 *  The upload chooser needs three things the server could answer and
 *  should not have to: which folders exist, what is already in one of
 *  them, and what a file would be called if the writer keeps both copies.
 *  All three are in the tree the rail is drawing, so asking costs nothing
 *  and the popover can open in the same frame the file picker closes in.
 */

export type Folder = { path: string; name: string; depth: number };

/** Every folder in the project, depth-first, with the root first.
 *
 *  The root is synthesised: it has no node of its own, which is also why
 *  nothing could be created at the project root until now. */
export function foldersIn(tree: TreeNode | null): Folder[] {
  const found: Folder[] = [{ path: "", name: "Project root", depth: 0 }];
  const walk = (node: TreeNode, depth: number) => {
    if (node.type !== "dir") return;
    found.push({ path: node.path, name: node.name, depth });
    for (const child of node.children ?? []) walk(child, depth + 1);
  };
  for (const child of tree?.children ?? []) walk(child, 1);
  return found;
}

/** The node at a path, or null.
 *
 *  Descends only into the folder that could contain the path rather than
 *  walking the whole tree, which matters on a project with a few hundred
 *  files being asked on every keystroke. */
export function findNode(tree: TreeNode | null, path: string): TreeNode | null {
  if (!tree) return null;
  if (path === "") return tree;
  if (tree.path === path) return tree;
  for (const child of tree.children ?? []) {
    if (child.path === path) return child;
    if (child.type !== "dir") continue;
    if (isInside(child.path, path)) {
      const hit = findNode(child, path);
      if (hit) return hit;
    }
  }
  return null;
}

/** Whether `path` is `parent` itself or sits somewhere beneath it.
 *
 *  The prefix has to be tested with the separator attached: `chapters` is
 *  not the parent of `chapters-old`, and a plain `startsWith` says it is.
 *  A drag guard that gets this wrong moves a folder into itself. */
export function isInside(parent: string, path: string): boolean {
  if (parent === "") return true;
  return path === parent || path.startsWith(`${parent}/`);
}

/** The names directly inside one folder -- files and folders alike, since
 *  a file cannot be written where a folder of that name sits. */
export function namesIn(tree: TreeNode | null, directory: string): Set<string> {
  const folder = findNode(tree, directory);
  return new Set((folder?.children ?? []).map((child) => child.name));
}

/** What "keep both" will call the new file.
 *
 *  This has to agree with `unique_name` on the server exactly: the chooser
 *  quotes the name back to the writer before anything is written, and a
 *  sentence that turns out to be wrong is worse than no sentence. */
export function keptBothName(existing: Set<string>, name: string): string {
  const dot = name.lastIndexOf(".");
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const suffix = dot > 0 ? name.slice(dot) : "";
  let index = 2;
  let candidate = `${stem} (${index})${suffix}`;
  while (existing.has(candidate)) {
    index += 1;
    candidate = `${stem} (${index})${suffix}`;
  }
  return candidate;
}

/** Files that already exist under the names being uploaded. */
export function collisions(
  tree: TreeNode | null,
  directory: string,
  names: string[],
): string[] {
  const taken = namesIn(tree, directory);
  return names.filter((name) => taken.has(name));
}

/** Every folder between the root and this path, so a file that lands in a
 *  collapsed folder can be shown rather than merely written. */
export function ancestorsOf(path: string): string[] {
  const parts = path.split("/").slice(0, -1);
  return parts.map((_, index) => parts.slice(0, index + 1).join("/"));
}


/** What a search should leave on screen.
 *
 *  `matches` is what the query actually found, for emphasis; `show` adds
 *  every folder on the way down to a match, because a result the writer
 *  cannot see the path to is not a result. Matching is case-insensitive
 *  and on the name rather than the full path: someone typing "intro"
 *  is looking for a file, not for every file in `introduction/`.
 */
export function search(
  tree: TreeNode | null,
  query: string,
): { matches: Set<string>; show: Set<string> } {
  const matches = new Set<string>();
  const show = new Set<string>();
  const needle = query.trim().toLowerCase();
  if (!tree || !needle) return { matches, show };

  const walk = (node: TreeNode, ancestors: string[]) => {
    const hit = node.name.toLowerCase().includes(needle);
    if (hit) {
      matches.add(node.path);
      show.add(node.path);
      for (const ancestor of ancestors) show.add(ancestor);
    }
    if (node.type !== "dir") return;
    const deeper = [...ancestors, node.path];
    for (const child of node.children ?? []) walk(child, deeper);
  };
  for (const child of tree.children ?? []) walk(child, []);
  return { matches, show };
}
